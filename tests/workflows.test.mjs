import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { defaultTemplate, cleanWorkflowTemplate, workflowRequest, cleanLesson, encodeLesson, decodeLesson } from "../public/workflow-templates.mjs";
import { workflowReadiness, prepareWorkflow } from "../server/workflows.mjs";
import { createStarterServer } from "../server/app.mjs";
import { readConfig } from "../server/config.mjs";
import { DemoService } from "../server/demo.mjs";
import { createRequest } from "../packages/sdk/index.js";

const parentId = "10000000-0000-4000-8000-000000000001";
const sampleLesson = { schema_version: "mwa_workflow_lesson_v1", title: "Warm direction", teacher: "Example teacher", objective: "Explore a more spacious breakdown.", template: defaultTemplate(), example_id: "published-example" };

async function fixture(t, { mode = "demo", service, importer } = {}) {
  let clock = 1000;
  const demo = new DemoService({ durationMs: 20, now: () => clock });
  let submissions = 0, reads = 0, inspections = 0, writes = 0;
  const music = service || { generate: (...args) => { submissions++; return demo.generate(...args); }, get: (...args) => { reads++; return demo.get(...args); }, cancel: (...args) => demo.cancel(...args) };
  const config = readConfig({ MWA_MODE: mode, MWA_API_KEY: "fixture-server-only-value", PORT: "0" });
  const server = createStarterServer(config, { service: music, ...(importer ? { audioImporter: { inspect: async () => { inspections++; throw new Error("No live fixture"); }, apply: async () => { writes++; throw new Error("No live fixture"); } } } : {}) });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function session() {
    const response = await fetch(`${base}/api/config`); const config = await response.json();
    const cookie = response.headers.get("set-cookie").split(";")[0];
    const request = (path, { body, key, headers = {}, method = body === undefined ? "GET" : "POST" } = {}) => fetch(`${base}${path}`, {
      method, headers: { Cookie: cookie, "X-Starter-CSRF": config.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { request, config };
  }
  return { base, ...(await session()), session, advance: () => { clock += 100; }, counters: () => ({ submissions, reads, inspections, writes }) };
}

test("public templates produce only supported SDK inputs; import cannot become generation", () => {
  const template = defaultTemplate();
  const input = workflowRequest(template);
  assert.deepEqual(Object.keys(input), ["prompt", "genre", "title"]);
  const wire = createRequest(input); assert.equal(wire.model, "mwa-edm-v1");
  assert.throws(() => workflowRequest(template, parentId), /cannot include a parent/);
  const variation = workflowRequest(defaultTemplate("make-variation"), parentId);
  assert.deepEqual(variation.revision, { kind: "variation", parent_generation_id: parentId });
  assert.throws(() => workflowRequest(defaultTemplate("make-variation"), "not-a-uuid"), /ready original/);
  assert.throws(() => workflowRequest(defaultTemplate("bring-to-ableton")), /separate reviewed plan/);
});

test("template boundaries reject execution, credentials, pricing, arbitrary controls and oversized Unicode", () => {
  for (const field of ["code", "url", "apiKey", "user_id", "price", "trial_eligible", "bpm", "duration", "commands"]) assert.throws(() => cleanWorkflowTemplate({ ...defaultTemplate(), [field]: "untrusted" }), /documented workflow fields/);
  assert.throws(() => cleanWorkflowTemplate({ ...defaultTemplate(), genre: "orchestral" }), /supported electronic/);
  assert.equal(cleanWorkflowTemplate({ ...defaultTemplate(), prompt: "é".repeat(750) }).prompt.length, 750);
  assert.throws(() => cleanWorkflowTemplate({ ...defaultTemplate(), prompt: "é".repeat(751) }), /1500 UTF-8/);
  assert.throws(() => cleanWorkflowTemplate({ ...defaultTemplate(), name: "界".repeat(41) }), /120 UTF-8/);
  assert.throws(() => cleanWorkflowTemplate({ ...defaultTemplate(), prompt: "Bearer " + "a".repeat(24) }), /credentials/);
  assert.throws(() => cleanWorkflowTemplate(JSON.parse('{"__proto__":{},"schema_version":"mwa_workflow_template_v1"}')), /documented workflow fields/);
});

test("lesson round trips Unicode as bounded data and rejects grants, URLs, parents or invalid encodings", () => {
  const lesson = { ...sampleLesson, title: "Groove — 音楽", teacher: "Zoë" };
  const token = encodeLesson(lesson); assert.deepEqual(decodeLesson(token), cleanLesson(lesson));
  const url = new URL(`https://preview.example/workflows#lesson=${token}`);
  assert.equal(url.search, ""); assert.equal(url.pathname, "/workflows");
  for (const key of ["trial_eligible", "credit_grant", "audioUrl", "parent_generation_id", "onOpen", "teacher_verified"]) assert.throws(() => cleanLesson({ ...lesson, [key]: true }), /documented workflow fields/);
  assert.throws(() => cleanLesson({ ...lesson, example_id: "https://private.example/audio" }), /showcase example ID/);
  for (const invalid of ["", "!", "a".repeat(5501), btoa("not json"), btoa(String.fromCharCode(255))]) assert.throws(() => decodeLesson(invalid));
});

test("readiness never equates a key to authentication, credits, bridge compatibility or real generation", () => {
  const live = workflowReadiness(readConfig({ MWA_MODE: "live", MWA_API_KEY: "fixture-server-only-value" }), { audioImportAvailable: true });
  assert.equal(live.account.status, "unavailable"); assert.equal(live.api.status, "configured_unverified");
  assert.equal(live.credits.balance, null); assert.equal(live.generation.allowed, false); assert.equal(live.generation.cost.credits, null);
  assert.equal(live.ableton.status, "enabled_unverified"); assert.equal(live.desktop.qualification, "pending");
  assert.ok(!JSON.stringify(live).includes("fixture-server-only-value"));
  const demo = workflowReadiness(readConfig({})); assert.equal(demo.generation.allowed, true); assert.equal(demo.generation.cost.credits, 0);
});

test("variation preparation requires an owned, completed, audio-ready parent", () => {
  const body = { template: defaultTemplate("make-variation"), parent_generation_id: parentId };
  for (const parent of [undefined, { status: "queued" }, { status: "failed", audioReady: true }, { status: "completed", audioReady: false }]) {
    const jobs = new Map(parent ? [[parentId, parent]] : []);
    assert.throws(() => prepareWorkflow(body, jobs), /ready original owned/);
  }
  assert.equal(prepareWorkflow(body, new Map([[parentId, { status: "completed", audioReady: true }]])).input.revision.parent_generation_id, parentId);
});

test("opening assets, readiness, preparation and handoff makes no generation or native call", async t => {
  const f = await fixture(t);
  for (const path of ["/workflows", "/workflows.js", "/workflow-templates.mjs", "/workflows.css", "/docs/workflows.md", "/examples/workflows/create-idea.json", "/examples/workflows/teacher-lesson.json"]) assert.equal((await f.request(path)).status, 200);
  const readiness = await (await f.request("/api/workflows/readiness")).json(); assert.equal(readiness.generation.cost.credits, 0);
  const prepared = await (await f.request("/api/workflows/prepare", { body: { template: defaultTemplate() } })).json();
  assert.equal(prepared.cost.credits, 0); assert.equal(prepared.allowed, true); assert.deepEqual(prepared.input, workflowRequest(defaultTemplate()));
  const handoff = await (await f.request("/api/workflows/handoff", { body: { template: defaultTemplate() } })).json();
  assert.equal(handoff.url, `/?workflow=${handoff.id}#studio`);
  assert.deepEqual((await (await f.request(`/api/workflows/handoff/${handoff.id}`)).json()).input, prepared.input);
  assert.deepEqual(f.counters(), { submissions: 0, reads: 0, inspections: 0, writes: 0 });
});

test("guided live runs fail on server before submitting, even with a configured key and forged price", async t => {
  const f = await fixture(t, { mode: "live", importer: true });
  const state = await (await f.request("/api/workflows/readiness")).json(); assert.equal(state.generation.allowed, false);
  const quote = await (await f.request("/api/workflows/prepare", { body: { template: defaultTemplate() } })).json(); assert.equal(quote.allowed, false); assert.equal(quote.cost.status, "unavailable");
  for (const body of [{ template: defaultTemplate() }, { template: defaultTemplate(), price: 0, trial_eligible: true }]) {
    const response = await f.request("/api/workflows/run", { body, key: "live-run-blocked" }); assert.equal(response.status, 409);
  }
  assert.equal((await f.request("/api/workflows/prepare", { body: { template: defaultTemplate(), price: 0 } })).status, 400);
  assert.deepEqual(f.counters(), { submissions: 0, reads: 0, inspections: 0, writes: 0 });
});

test("preview idea to variation creates playable local audio and preserves parent ownership", async t => {
  const f = await fixture(t);
  const original = await (await f.request("/api/workflows/run", { body: { template: defaultTemplate() }, key: "first-preview-key" })).json();
  assert.equal(original.demo, true); f.advance();
  const ready = await (await f.request(`/api/generations/${original.generation_id}`)).json(); assert.equal(ready.audio.status, "ready");
  const body = { template: defaultTemplate("make-variation"), parent_generation_id: original.generation_id };
  const other = await f.session();
  assert.equal((await other.request("/api/workflows/run", { body, key: "stolen-preview-key" })).status, 400);
  const variation = await (await f.request("/api/workflows/run", { body, key: "variation-preview-key" })).json();
  assert.equal(variation.parentId, original.generation_id); assert.equal(variation.revisionKind, "variation");
  f.advance(); const result = await (await f.request(`/api/generations/${variation.generation_id}`)).json(); assert.equal(result.audio.status, "ready");
  const audio = Buffer.from(await (await f.request(result.audio.url)).arrayBuffer()); assert.equal(audio.toString("ascii", 0, 4), "RIFF");
  assert.equal(f.counters().submissions, 2); assert.equal(f.counters().writes, 0);
});

test("workflow retries create one job; changed input cannot reuse its request identity", async t => {
  const f = await fixture(t);
  const body = { template: defaultTemplate() };
  const responses = await Promise.all([1, 2].map(() => f.request("/api/workflows/run", { body, key: "same-preview-key" })));
  const ids = await Promise.all(responses.map(response => response.json())); assert.equal(ids[0].generation_id, ids[1].generation_id);
  assert.equal(f.counters().submissions, 1);
  assert.equal((await f.request("/api/workflows/run", { body: { template: { ...body.template, prompt: "A different direction" } }, key: "same-preview-key" })).status, 409);
});

test("local workflow routes enforce CSRF, origin and session handoff ownership", async t => {
  const f = await fixture(t);
  assert.equal((await f.request("/api/workflows/readiness", { headers: { "X-Starter-CSRF": "wrong" } })).status, 403);
  assert.equal((await f.request("/api/workflows/run", { body: { template: defaultTemplate() }, key: "cross-site-run-key", headers: { Origin: "https://untrusted.example" } })).status, 403);
  const handoff = await (await f.request("/api/workflows/handoff", { body: { template: defaultTemplate() } })).json();
  const other = await f.session(); assert.equal((await other.request(`/api/workflows/handoff/${handoff.id}`)).status, 404);
  assert.equal((await f.request("/api/workflows/handoff", { body: { template: defaultTemplate(), lesson: sampleLesson } })).status, 400);
  assert.equal(f.counters().submissions, 0);
});

test("shipped workflow examples validate and offline CLI emits input without connecting", async () => {
  const template = JSON.parse(await readFile(new URL("../examples/workflows/create-idea.json", import.meta.url), "utf8"));
  const lesson = JSON.parse(await readFile(new URL("../examples/workflows/teacher-lesson.json", import.meta.url), "utf8"));
  cleanWorkflowTemplate(template); cleanLesson(lesson);
  const cwd = new URL("../", import.meta.url);
  const result = spawnSync(process.execPath, ["examples/workflows/prepare.mjs", "--template", "examples/workflows/create-idea.json"], { cwd, encoding: "utf8" });
  assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), workflowRequest(template));
});
