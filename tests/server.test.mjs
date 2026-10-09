import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { createStarterServer } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
import { DemoService } from "../server/demo.mjs";
import { MwaApiError } from "../packages/sdk/index.js";

const input = { prompt: "Warm house with a mellow groove", genre: "deep_house", title: "Golden hour" };
const id = "10000000-0000-4000-8000-000000000001";

function rawStatus(url, headers) {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, res => { res.resume(); res.on("end", () => resolve(res.statusCode)); });
    req.on("error", reject); req.end();
  });
}

async function fixture(t, options = {}) {
  let clock = 1000;
  const demo = new DemoService({ durationMs: 20, now: () => clock });
  const config = readConfig({ MWA_MODE: options.mode || "demo", PORT: "0", MWA_API_KEY: "test-only-token" });
  const server = createStarterServer(config, { service: options.service || demo, ...(options.showcase ? { showcase: options.showcase } : {}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${base}/api/config`);
  assert.equal(response.status, 200);
  const settings = await response.json();
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const request = (path, { body, key, method = body === undefined ? "GET" : "POST", headers, ...rest } = {}) => fetch(`${base}${path}`, {
    method, headers: { Cookie: cookie, "X-Starter-CSRF": settings.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body), ...rest,
  });
  return { server, base, request, settings, demo, advance: () => { clock += 100; } };
}

test("preview creates playable original audio, history, and range downloads without credentials", async t => {
  const f = await fixture(t);
  assert.equal(f.settings.mode, "demo"); assert.ok(!JSON.stringify(f.settings).includes("test-only-token"));
  const accepted = await f.request("/api/generations", { body: input, key: "preview-request" });
  assert.equal(accepted.status, 202);
  const job = await accepted.json(); assert.equal(job.demo, true); assert.equal(job.status, "in_progress");
  f.advance();
  const completed = await (await f.request(`/api/generations/${job.generation_id}`)).json();
  assert.equal(completed.status, "completed"); assert.equal(completed.audio.status, "ready");
  const audio = await f.request(completed.audio.url);
  assert.equal(audio.headers.get("content-type"), "audio/wav");
  const buffer = Buffer.from(await audio.arrayBuffer()); assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
  const range = await f.request(completed.audio.url, { headers: { Range: "bytes=0-43" } });
  assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 44);
  assert.equal((await f.request(completed.audio.url, { headers: { Range: "bytes=999999999-" } })).status, 416);
  const settings = await (await f.request("/api/config")).json();
  assert.equal(settings.recent[0].id, job.generation_id);
});

test("cancel stops a preview and allows a later generation", async t => {
  const f = await fixture(t);
  const job = await (await f.request("/api/generations", { body: input, key: "cancel-original" })).json();
  assert.equal((await f.request("/api/generations", { body: input, key: "another-request" })).status, 409);
  const cancelled = await (await f.request(`/api/generations/${job.generation_id}/cancel`, { body: {} })).json();
  assert.equal(cancelled.status, "cancelled"); assert.notEqual(cancelled.audio.status, "processing");
  assert.equal((await f.request("/api/generations", { body: input, key: "after-cancellation" })).status, 202);
});

test("sessions cannot read or modify each other's jobs and preview audio", async t => {
  const f = await fixture(t);
  const job = await (await f.request("/api/generations", { body: input, key: "owned-generation" })).json();
  const other = await fetch(`${f.base}/api/config`);
  const settings = await other.json();
  const cookie = other.headers.get("set-cookie").split(";")[0];
  const headers = { Cookie: cookie, "X-Starter-CSRF": settings.csrf, "Content-Type": "application/json" };
  for (const path of [`/api/generations/${job.generation_id}`, `/api/demo-audio/${job.generation_id}`]) {
    assert.equal((await fetch(`${f.base}${path}`, { headers })).status, 404);
  }
  assert.equal((await fetch(`${f.base}/api/generations/${job.generation_id}/cancel`, { method: "POST", headers, body: "{}" })).status, 404);
});

test("server blocks CSRF, DNS rebinding, private files, and unknown inputs", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/generations", { body: input, key: "blocked-request", headers: { Origin: "https://untrusted.example" } })).status, 403);
  assert.equal((await f.request("/api/generations", { body: input, key: "blocked-request", headers: { "X-Starter-CSRF": "wrong" } })).status, 403);
  assert.equal(await rawStatus(`${f.base}/api/config`, { Host: "untrusted.example" }), 403);
  assert.equal((await f.request("/api/config", { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
  for (const path of ["/.env", "/server/config.mjs", "/packages/sdk/index.js", "/package.json", "/%2e%2e/.env"]) {
    assert.equal((await f.request(path)).status, 404);
  }
  assert.equal((await f.request("/api/generations", { body: { ...input, user_id: "someone-else" }, key: "bad-request-fields" })).status, 400);
  const home = await f.request("/");
  assert.match(home.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.match(await home.text(), /id="share-dialog"/);
  for (const path of ["/share-card.js", "/generation-state.js", "/docs/setup-and-sharing.md"]) assert.equal((await f.request(path)).status, 200);
  assert.equal((await f.request("/scripts/setup.mjs")).status, 404);
});

test("retries and concurrent duplicate submissions create exactly one job", async t => {
  let submissions = 0;
  const service = { generate: async () => { submissions++; await new Promise(resolve => setTimeout(resolve, 15)); return { generation_id: id, status: "queued" }; } };
  const f = await fixture(t, { service, mode: "live" });
  const responses = await Promise.all([1, 2].map(() => f.request("/api/generations", { body: input, key: "one-request-key" })));
  for (const response of responses) assert.equal(response.status, 202);
  assert.equal(submissions, 1);
  assert.equal((await f.request("/api/generations", { body: input, key: "one-request-key" })).status, 202);
  assert.equal(submissions, 1);
  assert.equal((await f.request("/api/generations", { body: { ...input, prompt: "Different music" }, key: "one-request-key" })).status, 409);
});

test("ambiguous failures can be retried with the original key and body", async t => {
  const keys = [];
  const service = { generate: async (_, options) => { keys.push(options.idempotencyKey); if (keys.length === 1) throw new MwaApiError("Network interrupted"); return { generation_id: id, status: "queued" }; } };
  const f = await fixture(t, { service, mode: "live" });
  assert.equal((await f.request("/api/generations", { body: input, key: "recover-original" })).status, 502);
  assert.equal((await f.request("/api/generations", { body: input, key: "recover-original" })).status, 202);
  assert.deepEqual(keys, ["recover-original", "recover-original"]);
});

test("live projection includes only usable public links, without relaying extra backend fields", async t => {
  const service = {
    generate: async () => ({ generation_id: id, status: "queued" }),
    get: async () => ({ generation_id: id, status: "completed", progress: 1, unexpected_private_field: "not-for-browser", audio_export: { status: "ready", download_url: "javascript:alert(1)" }, artifact_manifest: { artifacts: [{ kind: "project_json", status: "ready", download_url: "https://files.example/project.json" }] } }),
  };
  const f = await fixture(t, { service, mode: "live" });
  await f.request("/api/generations", { body: input, key: "projection-request" });
  const data = await (await f.request(`/api/generations/${id}`)).json();
  assert.equal(data.audio.url, null); assert.equal(data.projectUrl, "https://files.example/project.json");
  assert.ok(!JSON.stringify(data).includes("not-for-browser"));
});

test("live configuration cannot expose the key through a public bind", () => {
  for (const env of [
    { MWA_MODE: "live" },
    { MWA_MODE: "live", MWA_API_KEY: "test", HOST: "0.0.0.0", PUBLIC_ORIGIN: "https://demo.example" },
    { MWA_MODE: "live", MWA_API_KEY: "test", PUBLIC_ORIGIN: "https://demo.example" },
  ]) assert.throws(() => readConfig(env), /Live mode requires/);
  const demo = readConfig({ MWA_MODE: "demo", HOST: "0.0.0.0", PUBLIC_ORIGIN: "https://demo.example", MWA_API_KEY: "ignored-test-key" });
  assert.equal(demo.apiKey, undefined); assert.equal(demo.publicOrigin, "https://demo.example");
});

test("visitors can arrive from a GitHub campaign link while cross-site API requests remain blocked", async t => {
  const f = await fixture(t);
  assert.equal(await rawStatus(`${f.base}/`, { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "navigate" }), 200);
  assert.equal(await rawStatus(`${f.base}/api/config`, { "Sec-Fetch-Site": "cross-site" }), 403);
});

test("empty showcase stays honest while anonymous A/B demo tracks are playable and distinct", async t => {
  const f = await fixture(t);
  const response = await fetch(`${f.base}/api/showcase`);
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.deepEqual(catalog.tracks, []); assert.equal(catalog.comparisonDemos.length, 2);
  const buffers = [];
  for (const track of catalog.comparisonDemos) {
    assert.equal(track.source, "starter_demo");
    const audio = await fetch(`${f.base}${track.audioUrl}`);
    assert.equal(audio.headers.get("content-type"), "audio/wav"); buffers.push(Buffer.from(await audio.arrayBuffer()));
  }
  assert.notDeepEqual(buffers[0], buffers[1]);
  assert.equal((await fetch(`${f.base}/api/showcase/audio/not-a-file`)).status, 404);
});

test("approved showcase exposes only declared public metadata", async t => {
  const f = await fixture(t, { showcase: { tracks: [{ id: "campaign-track", title: "Campaign track", genre: "techno", credit: "Example owner", audioUrl: "https://cdn.example.com/track.mp3", publicationApproved: true }] } });
  const catalog = await (await fetch(`${f.base}/api/showcase`)).json();
  assert.equal(catalog.tracks[0].audioUrl, "https://cdn.example.com/track.mp3");
  assert.equal(catalog.tracks[0].source, "mwa_api");
  assert.equal(catalog.tracks[0].publicationApproved, undefined);
});

test("a session variation retains parent identity and produces distinct fixture audio for comparison", async t => {
  const f = await fixture(t);
  const original = await (await f.request("/api/generations", { body: input, key: "comparison-original" })).json();
  f.advance();
  await f.request(`/api/generations/${original.generation_id}`);
  const child = await (await f.request("/api/generations", { body: { ...input, revision: { parent_generation_id: original.generation_id, kind: "variation" } }, key: "comparison-variation" })).json();
  assert.equal(child.parentId, original.generation_id); assert.equal(child.revisionKind, "variation");
  f.advance();
  const completed = await (await f.request(`/api/generations/${child.generation_id}`)).json();
  assert.equal(completed.audio.status, "ready");
  const a = Buffer.from(await (await f.request(`/api/demo-audio/${original.generation_id}`)).arrayBuffer());
  const b = Buffer.from(await (await f.request(completed.audio.url)).arrayBuffer());
  assert.notDeepEqual(a, b);
});
