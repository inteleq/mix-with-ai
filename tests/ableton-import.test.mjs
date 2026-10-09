import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm, readdir, readFile, writeFile, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { inspectAudioTargets, applyAudioToEmptyTrack, AudioImportPreconditionError } from "../integrations/ableton/import-audio.mjs";
import { createAudioImportStore } from "../server/audio-import-store.mjs";
import { createStarterServer } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
import { demoProject } from "../public/project-context.mjs";
import { moduleSpecifiers } from "../scripts/check-release.mjs";

const generationId = "10000000-0000-4000-8000-000000000001";
const audioUrl = "https://audio.example.test/result.wav?token=fixture-signed";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
function wav() {
  const bytes = Buffer.alloc(108); bytes.write("RIFF", 0); bytes.writeUInt32LE(100, 4); bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(44100, 24);
  bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write("data", 36); bytes.writeUInt32LE(64, 40); return bytes;
}
function ready(bytes = wav()) { return { generation_id: generationId, status: "completed", audio_export: { status: "ready", download_url: audioUrl }, artifact_manifest: { artifacts: [{ status: "ready", download_url: audioUrl, byte_size: bytes.length, checksum_sha256: hash(bytes) }] } }; }

test("release parser identifies real static/dynamic exports and ignores import labels inside strings", () => {
  const source = 'const label="--ableton-import"; const id="apply-audio-import"; import x from "./public.mjs"; export {x} from "./other.mjs"; await import("./reader.mjs");';
  assert.deepEqual(moduleSpecifiers(source, "fixture.mjs"), ["./public.mjs", "./other.mjs", "./reader.mjs"]);
  assert.throws(() => moduleSpecifiers("await import(path);", "fixture.mjs"), /Computed module/);
  assert.throws(() => moduleSpecifiers("require(path);", "fixture.mjs"), /Computed module/);
  assert.deepEqual(moduleSpecifiers('await import(pathToFileURL(join(temporary, "package/index.js")).href);', "scripts/pack-sdk.mjs"), []);
  assert.throws(() => moduleSpecifiers('await import(pathToFileURL(join(temporary, "private/index.js")).href);', "scripts/pack-sdk.mjs"), /Computed module/);
});

function liveFixture() {
  const calls = []; let writes = 0; let loseAcknowledgement = false; let skipReadback = false;
  const state = { file_path: join(tmpdir(), "MWA-disposable.als"), master_track: { raw: { id: "master-1" } }, tempo: 128, is_playing: false, record_mode: 0, session_record: false };
  const values = { name: "Empty audio", is_foldable: false, has_audio_input: true, has_midi_input: false, is_frozen: false, arm: false, arrangement_clips: [], devices: [], clip_slots: [], mute: false, solo: false };
  const track = { raw: { id: "track-1" }, async get(field) { calls.push(`track.${field}`); assert.ok(Object.hasOwn(values, field)); return values[field]; }, async createAudioClip(path, position) {
    calls.push("createAudioClip"); writes++; await new Promise(resolve => setTimeout(resolve, 10));
    if (!skipReadback) values.arrangement_clips = [{ async get(field) { return { is_audio_clip: true, file_path: path, start_time: position, end_time: position + 384 }[field]; } }];
    if (loseAcknowledgement) throw new Error("Lost acknowledgement");
  } };
  state.tracks = [track];
  const client = { song: { async get(field) { calls.push(`song.${field}`); assert.ok(Object.hasOwn(state, field)); return state[field]; } } };
  return { client, state, values, track, calls, writes: () => writes, loseAck: () => { loseAcknowledgement = true; }, unreadable: () => { skipReadback = true; } };
}

test("target inspection reads saved identity and lists empty ordinary audio tracks without native paths", async () => {
  const f = liveFixture(); const result = await inspectAudioTargets(f.client);
  assert.equal(result.targets.length, 1); assert.equal(result.targets[0].trackId, "track-1");
  assert.equal(result.scope.setLabel, "MWA-disposable.als"); assert.equal(f.writes(), 0);
  assert.ok(!JSON.stringify(result).includes(tmpdir()));
});

test("unsafe or unknown tracks and transport states cannot qualify", async () => {
  for (const patch of [{ arm: true }, { is_frozen: true }, { has_midi_input: true }, { devices: [{}] }, { arrangement_clips: [{}] }, { clip_slots: [{ get: async () => true }] }]) {
    const f = liveFixture(); Object.assign(f.values, patch); assert.equal((await inspectAudioTargets(f.client)).targets.length, 0); assert.equal(f.writes(), 0);
  }
  for (const patch of [{ file_path: "" }, { is_playing: true }, { record_mode: 1 }, { session_record: true }, { is_playing: undefined }]) {
    const f = liveFixture(); Object.assign(f.state, patch); await assert.rejects(inspectAudioTargets(f.client), AudioImportPreconditionError); assert.equal(f.writes(), 0);
  }
});

test("one audio placement uses exact track identity and readback, never track creation or index fallback", async () => {
  const f = liveFixture(); const inspected = await inspectAudioTargets(f.client);
  f.state.tracks.unshift({ raw: { id: "different-track" } });
  const result = await applyAudioToEmptyTrack(f.client, { scope: inspected.scope, target: inspected.targets[0], positionBeats: 16, filePath: join(tmpdir(), "fixture.wav") });
  assert.deepEqual(result, { status: "applied", acknowledged: true, positionBeats: 16, lengthBeats: 384 }); assert.equal(f.writes(), 1);
  assert.ok(!f.calls.some(call => /delete|createAudioTrack|setParam|tempo\.set/.test(call)));
});

test("changed Set, tempo, track or populated destination rejects before any mutation", async () => {
  for (const change of [f => { f.state.file_path = join(tmpdir(), "Other.als"); }, f => { f.state.tempo = 120; }, f => { f.values.name = "Renamed"; }, f => { f.values.arrangement_clips = [{}]; }, f => { f.state.tracks = []; }]) {
    const f = liveFixture(); const inspected = await inspectAudioTargets(f.client); change(f);
    await assert.rejects(applyAudioToEmptyTrack(f.client, { scope: inspected.scope, target: inspected.targets[0], positionBeats: 0, filePath: join(tmpdir(), "fixture.wav") }), AudioImportPreconditionError);
    assert.equal(f.writes(), 0);
  }
});

test("lost acknowledgement requires exact readback, and an unknown result never claims success", async () => {
  const verified = liveFixture(); const first = await inspectAudioTargets(verified.client); verified.loseAck();
  const result = await applyAudioToEmptyTrack(verified.client, { scope: first.scope, target: first.targets[0], positionBeats: 0, filePath: join(tmpdir(), "fixture.wav") });
  assert.equal(result.status, "applied"); assert.equal(result.acknowledged, false); assert.equal(verified.writes(), 1);
  const unknown = liveFixture(); const second = await inspectAudioTargets(unknown.client); unknown.unreadable(); unknown.loseAck();
  assert.equal((await applyAudioToEmptyTrack(unknown.client, { scope: second.scope, target: second.targets[0], positionBeats: 0, filePath: join(tmpdir(), "fixture.wav") })).status, "needs_review"); assert.equal(unknown.writes(), 1);
});

test("deadline checks prevent late dispatch and preserve uncertainty if the deadline expires after a write", async () => {
  const blocked = liveFixture(); const first = await inspectAudioTargets(blocked.client);
  await assert.rejects(applyAudioToEmptyTrack(blocked.client, { scope: first.scope, target: first.targets[0], positionBeats: 0, filePath: join(tmpdir(), "fixture.wav") }, () => { throw new Error("Expired"); }), /Expired/);
  assert.equal(blocked.writes(), 0);
  const late = liveFixture(); const second = await inspectAudioTargets(late.client); let expired = false;
  const create = late.track.createAudioClip;
  late.track.createAudioClip = async (...args) => { await create(...args); expired = true; };
  const result = await applyAudioToEmptyTrack(late.client, { scope: second.scope, target: second.targets[0], positionBeats: 0, filePath: join(tmpdir(), "fixture.wav") }, () => { if (expired) throw new Error("Expired"); });
  assert.equal(result.status, "needs_review"); assert.equal(late.writes(), 1);
});

async function temporary(t) { const directory = await mkdtemp(join(tmpdir(), "mwa-audio-import-")); t.after(() => rm(directory, { recursive: true, force: true })); return directory; }

test("storage download omits credentials and redirects, validates bytes and retains immutable cached audio", async t => {
  const directory = await temporary(t); const bytes = wav(); let calls = 0;
  const store = createAudioImportStore({ directory, downloadFetch: async (url, options) => {
    calls++; assert.equal(url.href, audioUrl); assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit"); assert.equal(options.headers, undefined);
    assert.ok(!JSON.stringify(options).includes("fixture-key")); return new Response(bytes, { headers: { "Content-Length": String(bytes.length) } });
  } });
  const asset = await store.stage(ready(bytes)); await store.verify(asset); assert.equal(asset.checksum, hash(bytes));
  assert.equal((await store.stage(ready(bytes))).filePath, asset.filePath); assert.equal(calls, 2);
  await writeFile(asset.filePath, Buffer.alloc(bytes.length)); await assert.rejects(store.verify(asset), /changed/);
});

test("storage rejects unsupported data, integrity mismatch, excessive size, unsafe URLs and symlinked cache", async t => {
  const directory = await temporary(t);
  const invalid = createAudioImportStore({ directory, downloadFetch: async () => new Response("not audio") });
  await assert.rejects(invalid.stage(ready()), /WAV or MP3/);
  const mismatch = createAudioImportStore({ directory, downloadFetch: async () => new Response(wav()) });
  const job = ready(); job.artifact_manifest.artifacts[0].checksum_sha256 = "a".repeat(64); await assert.rejects(mismatch.stage(job), /integrity/);
  const huge = createAudioImportStore({ directory, downloadFetch: async () => new Response(wav(), { headers: { "Content-Length": String(65 * 1024 * 1024) } }) });
  await assert.rejects(huge.stage(ready()), /64 MiB/);
  for (const url of ["http://example.test/a.wav", "https://127.0.0.1/a.wav", "https://user:pass@example.test/a.wav", "file:///private/audio.wav"]) {
    await assert.rejects(mismatch.stage({ ...ready(), audio_export: { status: "ready", download_url: url } }), /HTTPS/);
  }
  const redirected = await temporary(t); await symlink(directory, join(redirected, "ableton-imports"));
  const symlinked = createAudioImportStore({ directory: redirected, downloadFetch: async () => new Response(wav()) });
  await assert.rejects(symlinked.stage(ready()), /regular private/);
});

test("an exclusive durable start marker blocks replay and receipts contain no URL or native path", async t => {
  const directory = await temporary(t); const store = createAudioImportStore({ directory });
  const id = "20000000-0000-4000-8000-000000000002";
  await store.prepare({ id, generation_id: generationId, status: "prepared" }); await store.begin(id);
  await assert.rejects(store.begin(id), { code: "EEXIST" }); await store.finish(id, { status: "needs_review" });
  const receipt = await readFile(join(directory, "ableton-imports", "receipts", `${id}.receipt.json`), "utf8");
  assert.equal(JSON.parse(receipt).status, "needs_review"); assert.ok(!receipt.includes("https:") && !receipt.includes(directory));
});

async function serverFixture(t) {
  const directory = await temporary(t); const live = liveFixture(); let clock = Date.now(); let statusReads = 0;
  const bytes = wav(); const downloads = [];
  const store = createAudioImportStore({ directory, downloadFetch: async (url, options) => { downloads.push({ url: url.href, options }); return new Response(bytes); } });
  const importer = { inspect: () => inspectAudioTargets(live.client), apply: input => applyAudioToEmptyTrack(live.client, input) };
  const service = { async generate() { return ready(bytes); }, async get(id) { assert.equal(id, generationId); statusReads++; return ready(bytes); } };
  const config = readConfig({ MWA_MODE: "live", MWA_API_KEY: "fixture-server-key", PORT: "0" });
  const server = createStarterServer(config, { service, audioImporter: importer, importStore: store, now: () => clock, readProject: async () => ({ project: demoProject(), warnings: [] }) });
  server.listen(0, "127.0.0.1"); await once(server, "listening"); t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function session() {
    const res = await fetch(`${base}/api/config`); const settings = await res.json(); const cookie = res.headers.get("set-cookie").split(";")[0];
    const request = (path, body, headers = {}) => fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, "X-Starter-CSRF": settings.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { settings, request };
  }
  const s = await session();
  assert.equal((await s.request("/api/generations", { prompt: "Warm house", genre: "deep_house" }, { "Idempotency-Key": "fixture-generation" })).status, 202);
  async function prepare() {
    assert.equal((await s.request("/api/ableton/targets", {})).status, 200);
    const res = await s.request("/api/ableton/imports", { generation_id: generationId, track_id: "track-1", position_beats: 16 }); assert.equal(res.status, 200); return res.json();
  }
  return { ...s, directory, live, store, session, downloads, statusReads: () => statusReads, prepare, advance: ms => { clock += ms; } };
}

test("preview downloads only an owned result, does not mutate, and confirmed duplicate applies dispatch once", async t => {
  const f = await serverFixture(t); assert.equal(f.live.writes(), 0); assert.equal(f.statusReads(), 0);
  const plan = await f.prepare(); assert.equal(f.live.writes(), 0); assert.equal(f.statusReads(), 1); assert.equal(f.downloads.length, 1);
  assert.ok(!JSON.stringify(plan).includes("fixture-server-key")); assert.ok(!JSON.stringify(plan).includes(f.directory)); assert.ok(!JSON.stringify(plan).includes("fixture-signed"));
  assert.equal((await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: false })).status, 400);
  const replies = await Promise.all([f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true }), f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true })]);
  for (const reply of replies) { assert.equal(reply.status, 200); assert.equal((await reply.json()).status, "applied"); }
  assert.equal(f.live.writes(), 1);
  assert.equal((await (await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true })).json()).status, "applied"); assert.equal(f.live.writes(), 1);
  assert.equal(f.statusReads(), 1);
});

test("import ownership, CSRF, origin checks and strict fields block foreign or arbitrary execution requests", async t => {
  const f = await serverFixture(t); const plan = await f.prepare(); const other = await f.session();
  assert.equal((await other.request(`/api/ableton/imports/${plan.id}`)).status, 404);
  assert.equal((await other.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true })).status, 404);
  assert.equal((await other.request("/api/ableton/imports", { generation_id: generationId, track_id: "track-1", position_beats: 0 })).status, 404);
  assert.equal((await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true }, { "X-Starter-CSRF": "wrong" })).status, 403);
  assert.equal((await f.request("/api/ableton/targets", {}, { Origin: "https://untrusted.example.test" })).status, 403);
  assert.equal((await f.request("/api/ableton/imports", { generation_id: generationId, track_id: "track-1", position_beats: 0, filePath: "/private/file" })).status, 400);
  assert.equal((await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true, command: "deleteTrack" })).status, 400); assert.equal(f.live.writes(), 0);
});

test("stale preview or changed target is rejected without a write, and uncertain dispatch is never repeated", async t => {
  const expired = await serverFixture(t); const old = await expired.prepare(); expired.advance(600001);
  assert.equal((await (await expired.request(`/api/ableton/imports/${old.id}/apply`, { confirm: true })).json()).status, "expired"); assert.equal(expired.live.writes(), 0);
  const changed = await serverFixture(t); const planned = await changed.prepare(); changed.live.values.devices = [{}];
  assert.equal((await (await changed.request(`/api/ableton/imports/${planned.id}/apply`, { confirm: true })).json()).status, "rejected"); assert.equal(changed.live.writes(), 0);
  const unknown = await serverFixture(t); const ambiguous = await unknown.prepare(); unknown.live.unreadable(); unknown.live.loseAck();
  assert.equal((await (await unknown.request(`/api/ableton/imports/${ambiguous.id}/apply`, { confirm: true })).json()).status, "needs_review");
  assert.equal((await (await unknown.request(`/api/ableton/imports/${ambiguous.id}/apply`, { confirm: true })).json()).status, "needs_review"); assert.equal(unknown.live.writes(), 1);
});

test("cache tampering and default/demo/public mode cannot dispatch audio placement", async t => {
  const f = await serverFixture(t); const plan = await f.prepare(); const media = join(f.directory, "ableton-imports", "media");
  await writeFile(join(media, (await readdir(media))[0]), Buffer.alloc(108));
  assert.equal((await (await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true })).json()).status, "rejected"); assert.equal(f.live.writes(), 0);
  assert.throws(() => createStarterServer({ mode: "demo", host: "127.0.0.1" }, { audioImporter: {} }), /explicitly enabled live/);
  assert.throws(() => createStarterServer({ mode: "live", host: "0.0.0.0" }, { audioImporter: {} }), /loopback/);
});

test("a preexisting dispatch marker blocks native execution even when in-memory preview says prepared", async t => {
  const f = await serverFixture(t); const plan = await f.prepare(); await f.store.begin(plan.id);
  const response = await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true });
  assert.equal((await response.json()).status, "needs_review"); assert.equal(f.live.writes(), 0);
  await f.request(`/api/ableton/imports/${plan.id}/apply`, { confirm: true }); assert.equal(f.live.writes(), 0);
});
