import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { cleanProject, selectedContext, buildContextPrompt, demoProject, PROJECT_SCHEMA } from "../public/project-context.mjs";
import { captureProject } from "../integrations/ableton/capture.mjs";
import { createStarterServer } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";

test("fresh projection removes unknown identity, path, media, preset and credential fields at every level", () => {
  const project = demoProject();
  project.user_id = "other-user"; project.privateWorkflow = { secret: true };
  Object.assign(project.tracks[0], { filePath: "private-path", apiKey: "fixture-secret", audioUrl: "https://example.test/signed", devices: ["Compressor", { source: "private-plugin-code" }] });
  project.tracks[0].clips[0].notes = [{ secret: true }];
  const cleaned = cleanProject(project);
  const json = JSON.stringify(cleaned);
  for (const value of ["user_id", "privateWorkflow", "filePath", "fixture-secret", "audioUrl", "notes", "private-plugin-code"]) assert.ok(!json.includes(value));
  assert.equal(cleaned.tracks[0].devices[1], "Device 2");
  assert.notEqual(cleaned.tracks, project.tracks);
});

test("context excludes unselected tracks, names, device labels, title and caller identifiers by default", () => {
  const project = demoProject(); project.title = "Private title"; project.tracks[0].id = "PrivateHandle"; project.tracks[1].selected = false;
  const context = selectedContext(project);
  assert.equal(context.tracks.length, 2); assert.equal(context.tracks[0].id, "track-1");
  for (const value of ["Private title", "PrivateHandle", "Drums", "Bass", "Compressor", "Warmth"]) assert.ok(!JSON.stringify(context).includes(value));
  const named = selectedContext(project, { includeNames: true });
  assert.equal(named.tracks[0].name, "Drums"); assert.equal(named.tracks[0].clips[0].name, "Groove");
});

test("recognized unsafe labels are replaced rather than carried into exports or prompts", () => {
  const project = demoProject(); project.title = `mwa_test_${"x".repeat(40)}`;
  project.tracks[0].name = "/private/music/session"; project.tracks[0].clips[0].name = "https://example.test/signed?token=private";
  const cleaned = cleanProject(project);
  assert.equal(cleaned.title, "Untitled draft"); assert.equal(cleaned.tracks[0].name, "Track 1"); assert.equal(cleaned.tracks[0].clips[0].name, "Clip 1");
  const prompt = buildContextPrompt(cleaned, { includeNames: true, intent: "Make warm house" }).prompt;
  assert.ok(!prompt.includes("token=private"));
});

test("drafts reject wrong schemas, nonfinite values, duplicate handles and oversized graphs", () => {
  const invalid = [
    { schema_version: "private_schema", source: "ableton" },
    { ...demoProject(), tempo: NaN },
    { ...demoProject(), tempo: 999 },
    { ...demoProject(), tracks: [] },
    { ...demoProject(), tracks: Array(129).fill(demoProject().tracks[0]) },
  ];
  const duplicate = demoProject(); duplicate.tracks[1].id = duplicate.tracks[0].id; invalid.push(duplicate);
  const oversize = demoProject(); oversize.tracks[0].clips = Array(1025).fill(oversize.tracks[0].clips[0]); invalid.push(oversize);
  const badPan = demoProject(); badPan.tracks[0].pan = 2; invalid.push(badPan);
  const negativeClip = demoProject(); negativeClip.tracks[0].clips[0].start_beats = -1; invalid.push(negativeClip);
  const stringSelection = demoProject(); stringSelection.tracks[0].selected = "false"; invalid.push(stringSelection);
  for (const input of invalid) assert.throws(() => cleanProject(input));
  const unselected = demoProject(); unselected.tracks.forEach(track => { track.selected = false; });
  assert.throws(() => selectedContext(unselected), /Select at least one/);
});

test("the handoff describes new fixed-profile generation and bounds UTF-8 without claiming project materialization", () => {
  const project = demoProject(); project.tempo = 92;
  const prepared = buildContextPrompt(project, { intent: "Make a warmer variation of the arrangement's energy" });
  assert.match(prepared.prompt, /Source arrangement: 92 BPM/); assert.match(prepared.prompt, /new 180-second track at 128 BPM/);
  assert.match(prepared.prompt, /not project import, audio analysis/); assert.equal(prepared.context.schema_version, PROJECT_SCHEMA);
  assert.ok(new TextEncoder().encode(prepared.prompt).byteLength <= 1500);
  project.tracks.forEach(track => { track.name = "🎵".repeat(60); });
  assert.throws(() => buildContextPrompt(project, { intent: "🎵".repeat(250), includeNames: true }), /Shorten/);
});

function fakeClient({ missingClips = false, changedTempo = false, stall = false } = {}) {
  const calls = []; let tempoReads = 0; let closed = 0;
  const object = (name, values) => ({ async get(field) {
    calls.push(`${name}.${field}`);
    if (values[field] instanceof Error) throw values[field];
    assert.ok(Object.hasOwn(values, field), `Unexpected read ${name}.${field}`);
    return values[field];
  } });
  const mixer = object("mixer", { volume: object("volume", { value: 0.7 }), panning: object("pan", { value: -0.1 }) });
  const track = object("track", { name: "Bass", is_foldable: false, has_midi_input: true, mute: false, mixer_device: mixer, devices: [object("device", { name: "Instrument" })], arrangement_clips: missingClips ? new Error("Unsupported") : [object("clip", { name: "Line", start_time: 8, end_time: 24 })] });
  const master = object("master", { name: "Master", mixer_device: mixer, devices: [] });
  const client = { async start() { calls.push("start"); if (stall) await new Promise(() => {}); }, async close() { calls.push("close"); closed++; }, song: { async get(field) {
    calls.push(`song.${field}`);
    if (field === "tempo") return changedTempo && tempoReads++ ? 130 : 128;
    if (field === "tracks") return [track]; if (field === "return_tracks") return []; if (field === "master_track") return master;
    throw new Error("Unexpected song read");
  } } };
  return { client, calls, closed: () => closed };
}

test("reader acquires only bounded metadata with get calls, local handles and guaranteed cleanup", async () => {
  const f = fakeClient(); const result = await captureProject(f.client);
  assert.equal(result.project.source, "ableton"); assert.equal(result.project.tracks[0].kind, "midi");
  assert.deepEqual(result.project.tracks[0].clips[0], { name: "Line", start_beats: 8, length_beats: 16 });
  assert.equal(result.project.tracks[1].kind, "master"); assert.equal(result.atomic, false); assert.equal(f.closed(), 1);
  for (const field of ["notes", "file_path", "parameters", "set", "addListener", "sendCommand"]) assert.ok(!f.calls.some(call => call.endsWith(`.${field}`)));
  assert.deepEqual(result.warnings, []);
});

test("unsupported optional arrangement reads are disclosed; tempo changes fail without a baseline", async () => {
  const f = fakeClient({ missingClips: true }); const result = await captureProject(f.client);
  assert.deepEqual(result.warnings, ["arrangement_clips_unavailable"]); assert.equal(result.project.tracks[0].clips.length, 0);
  const changed = fakeClient({ changedTempo: true });
  await assert.rejects(captureProject(changed.client), /Tempo changed/); assert.equal(changed.closed(), 1);
});

test("reader closes a stalled connection at the deadline", async () => {
  const f = fakeClient({ stall: true });
  await assert.rejects(captureProject(f.client, { timeoutMs: 10 }), /timed out/); assert.equal(f.closed(), 1);
  assert.deepEqual(f.calls, ["start", "close"]);
});

async function serverFixture(t, options = {}) {
  let generationCalls = 0;
  const service = { async generate(input) { generationCalls++; return { generation_id: "10000000-0000-4000-8000-000000000001", status: "queued", audio_export: { status: "unavailable" }, input }; } };
  const config = readConfig({ PORT: "0", MWA_MODE: "live", MWA_API_KEY: "fixture-only-server-key" });
  const server = createStarterServer(config, { service, ...options });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function session() {
    const res = await fetch(`${base}/api/config`); const settings = await res.json(); const cookie = res.headers.get("set-cookie").split(";")[0];
    const request = (path, body, headers = {}) => fetch(base + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: cookie, "X-Starter-CSRF": settings.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { request, settings };
  }
  return { base, session, calls: () => generationCalls };
}

test("local clean and handoff never call hosted music; a reviewed prompt can be explicitly submitted", async t => {
  const f = await serverFixture(t); const s = await f.session();
  const clean = await s.request("/api/project/clean", { project: { ...demoProject(), user_id: "untrusted-owner" } });
  assert.equal(clean.status, 200); assert.ok(!JSON.stringify(await clean.json()).includes("untrusted-owner"));
  const res = await s.request("/api/project/handoff", { project: demoProject(), intent: "Make warm house", includeNames: false });
  assert.equal(res.status, 200); const handoff = await res.json(); assert.equal(f.calls(), 0);
  assert.ok(!JSON.stringify(handoff).includes("fixture-only-server-key"));
  assert.equal((await s.request(`/api/project/handoff/${handoff.id}`)).status, 200);
  const other = await f.session(); assert.equal((await other.request(`/api/project/handoff/${handoff.id}`)).status, 404);
  const generated = await s.request("/api/generations", { prompt: handoff.prompt, genre: "deep_house" }, { "Idempotency-Key": "reviewed-project-request" });
  assert.equal(generated.status, 202); assert.equal(f.calls(), 1);
});

test("project routes reject CSRF, foreign origins, wrong schema and oversized inputs", async t => {
  const f = await serverFixture(t); const s = await f.session(); const body = { project: demoProject() };
  assert.equal((await s.request("/api/project/clean", body, { "X-Starter-CSRF": "wrong" })).status, 403);
  assert.equal((await s.request("/api/project/handoff", body, { Origin: "https://untrusted.example.test" })).status, 403);
  assert.equal((await s.request("/api/project/clean", { project: { schema_version: "private" } })).status, 400);
  assert.equal((await s.request("/api/project/clean", { project: demoProject(), padding: "x".repeat(262144) })).status, 413);
  assert.equal((await s.request("/api/project/capture", {})).status, 409); assert.equal(f.calls(), 0);
});

test("reader is explicit, single-flight, key-free and forbidden on a public listener", async t => {
  let reads = 0; let release;
  const f = await serverFixture(t, { readProject: async (...args) => { assert.deepEqual(args, []); reads++; await new Promise(resolve => { release = resolve; }); return { project: demoProject(), warnings: [] }; } });
  const s = await f.session(); assert.equal(reads, 0); assert.equal(s.settings.abletonReaderAvailable, true);
  const capture = s.request("/api/project/capture", {});
  while (!release) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal((await s.request("/api/project/capture", {})).status, 409);
  release(); assert.equal((await capture).status, 200); assert.equal(reads, 1); assert.equal(f.calls(), 0);
  assert.throws(() => createStarterServer({ host: "0.0.0.0", mode: "demo" }, { readProject: () => {} }), /loopback-only/);
});

test("handoff storage is bounded and upstream failures never expose raw data", async t => {
  const f = await serverFixture(t, { readProject: async () => { throw new Error("private-path fixture-only-server-key"); } });
  const s = await f.session(); let first;
  for (let i = 0; i < 11; i++) { const result = await (await s.request("/api/project/handoff", { project: demoProject() })).json(); first ??= result.id; }
  assert.equal((await s.request(`/api/project/handoff/${first}`)).status, 404);
  const failed = await s.request("/api/project/capture", {}); assert.equal(failed.status, 502);
  assert.ok(!(await failed.text()).includes("fixture-only-server-key"));
});

test("workspace and guide are served, source modules remain private and UI discloses draft limits", async t => {
  const f = await serverFixture(t); const s = await f.session();
  for (const path of ["/project", "/project.js", "/project.css", "/project-context.mjs", "/docs/ableton-projects.md"]) assert.equal((await s.request(path)).status, 200);
  for (const path of ["/integrations/ableton/read.mjs", "/integrations/ableton/package.json", "/server/app.mjs"]) assert.equal((await s.request(path)).status, 404);
  const html = await (await s.request("/project")).text(); assert.match(html, /Edits change this local draft only/); assert.match(html, /does not import this project/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]); assert.equal(new Set(ids).size, ids.length);
  const script = await readFile(new URL("../public/project.js", import.meta.url), "utf8"); assert.doesNotMatch(script, /innerHTML|process\.env/);
});
