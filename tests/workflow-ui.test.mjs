// Browserless controller test with an in-memory DOM and HTTP fixtures.
// No browser is launched; no network, account, credit or Live operations occur.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { encodeLesson, defaultTemplate } from "../public/workflow-templates.mjs";
import { workflowReadiness } from "../server/workflows.mjs";

test("lesson opening has no effects; explicit preview safely recovers a lost response and compares a variation", async t => {
  const all = [];
  class Element extends EventTarget {
    constructor(tag = "div") { super(); this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.dataset = {}; this._value = ""; this.disabled = false; this.hidden = false; this.checked = false; this.paused = true; this.duration = 15; this.currentTime = 0; this.textContent = ""; all.push(this); }
    set value(value) { this._value = String(value); }
    get value() { return this._value; }
    set src(value) { this.attrs.src = value; }
    get src() { return this.attrs.src || ""; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    removeAttribute(key) { delete this.attrs[key]; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; if (this.tagName === "SELECT") this.value = nodes[0]?.value || ""; }
    remove() {}
    focus() {}
    scrollIntoView() {}
    reportValidity() { return true; }
    select() {}
    pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
    load() {}
    async play() { this.paused = false; this.dispatchEvent(new Event("play")); }
    click() { this.dispatchEvent(new Event("click", { cancelable: true })); }
  }
  const html = await readFile(new URL("../public/workflows.html", import.meta.url), "utf8");
  const nodes = new Map();
  for (const match of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    assert.ok(!nodes.has(match[3]), `Duplicate HTML id: ${match[3]}`);
    const node = new Element(match[1]); node.id = match[3]; node.disabled = /\bdisabled\b/.test(match[2]); node.hidden = /\bhidden\b/.test(match[2]);
    node.value = match[2].match(/\bvalue="([^"]*)"/)?.[1] || ""; nodes.set(node.id, node);
  }
  const document = Object.assign(new EventTarget(), { body: new Element("body"), getElementById: id => { assert.ok(nodes.has(id), `Missing HTML control: ${id}`); return nodes.get(id); }, createElement: tag => new Element(tag), querySelectorAll: selector => all.filter(node => selector === ".workflow-card" ? node.className === "workflow-card" : selector === "audio" && node.tagName === "AUDIO") });
  function memory() { const values = new Map(); return { values, getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }; }
  const local = memory(), session = memory();
  const lesson = { schema_version: "mwa_workflow_lesson_v1", title: "Lesson <img src=x onerror=alert(1)>", teacher: "Example teacher", objective: "Explore warm chords.", template: defaultTemplate() };
  const location = new URL(`http://127.0.0.1:3008/workflows#lesson=${encodeLesson(lesson)}`);
  location.assign = () => { throw new Error("Unexpected navigation"); };
  const window = Object.assign(new EventTarget(), { history: { replaceState() {} } });
  const settings = { mode: "demo", csrf: "fixture-csrf", recent: [], abletonImportAvailable: false, appUrl: "https://mixwithai.com", repositoryUrl: "https://github.com/inteleq/mix-with-ai" };
  const jobs = new Map(), requests = [], submissions = [], requestKeys = new Map();
  let loseFirstResponse = true;
  async function fakeFetch(path, options = {}) {
    const method = options.method || "GET"; requests.push({ path, method, key: options.headers?.["Idempotency-Key"] });
    let result;
    if (path === "/api/config") result = settings;
    else if (path === "/api/workflows/readiness") result = workflowReadiness({ mode: "demo" });
    else if (path === "/api/showcase") result = { tracks: [], comparisonDemos: [{ id: "demo-after-hours", source: "starter_demo", title: "Synthetic A", audioUrl: "/api/showcase/audio/demo-after-hours" }, { id: "demo-after-hours-variation", source: "starter_demo", title: "Synthetic B", audioUrl: "/api/showcase/audio/demo-after-hours-variation" }] };
    else if (path === "/api/workflows/prepare") result = { allowed: true, cost: { status: "preview", credits: 0 } };
    else if (path === "/api/workflows/run") {
      const body = JSON.parse(options.body), key = options.headers["Idempotency-Key"];
      if (requestKeys.has(key)) result = jobs.get(requestKeys.get(key));
      else {
        const id = `10000000-0000-4000-8000-${String(jobs.size + 1).padStart(12, "0")}`;
        result = { generation_id: id, title: body.template.name, genre: body.template.genre, status: "completed", stage: "ready", progress: 1, demo: true, parentId: body.parent_generation_id || null, audio: { status: "ready", url: `/api/demo-audio/${id}` }, studioUrl: null, warnings: [] };
        jobs.set(id, result); requestKeys.set(key, id); submissions.push(body);
      }
      if (loseFirstResponse) { loseFirstResponse = false; throw new Error("Response lost after acceptance"); }
    } else if (path.startsWith("/api/generations/")) result = jobs.get(path.split("/").at(-1));
    else throw new Error(`Unexpected request: ${method} ${path}`);
    return { ok: true, status: 200, headers: new Headers(), json: async () => structuredClone(result) };
  }
  const globals = { document, window, location, localStorage: local, sessionStorage: session, fetch: fakeFetch };
  const prior = new Map(Object.keys(globals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(globals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  t.after(() => { for (const [key, descriptor] of prior) descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]; });
  await import("../public/workflows.js");
  const $ = id => nodes.get(id);
  assert.equal($("workflow-error").hidden, true);
  assert.equal($("lesson-heading").textContent, lesson.title); assert.equal($("lesson-context").hidden, false);
  assert.equal(local.values.size, 0); assert.equal(session.values.size, 0);
  assert.deepEqual(requests.map(item => item.path), ["/api/config", "/api/workflows/readiness", "/api/showcase"]);
  assert.equal(submissions.length, 0); assert.equal($("run-workflow").disabled, true);
  $("workflow-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(submissions.length, 0);
  async function until(condition) {
    for (let i = 0; i < 50; i++) { if (condition()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
    assert.fail("Controller did not reach the expected state");
  }
  $("run-consent").checked = true; $("run-consent").dispatchEvent(new Event("change"));
  $("workflow-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await until(() => !$("retry-workflow").hidden && !$("retry-workflow").disabled);
  assert.equal(submissions.length, 1); assert.equal($("workflow-name").disabled, true);
  $("retry-workflow").click();
  await until(() => !$("use-variation").disabled);
  assert.equal(submissions.length, 1); assert.equal(session.values.size, 0);
  const runs = requests.filter(item => item.path === "/api/workflows/run"); assert.equal(runs.length, 2); assert.equal(runs[0].key, runs[1].key);
  $("use-variation").click();
  assert.equal($("parent-choice").hidden, false); assert.ok($("workflow-parent").value);
  assert.equal($("run-workflow").disabled, true); // Consent resets for the next request.
  $("run-consent").checked = true; $("run-consent").dispatchEvent(new Event("change"));
  $("workflow-form").dispatchEvent(new Event("submit", { cancelable: true }));
  await until(() => submissions.length === 2 && !$("workflow-comparison").hidden && !$("use-variation").disabled);
  assert.equal(submissions[1].parent_generation_id, [...jobs.keys()][0]);
  $("compare-original").click(); await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal($("compare-original").attrs["aria-pressed"], "true");
  assert.equal(requests.some(item => item.path.startsWith("/api/ableton/")), false);
  assert.equal($("inspect-import-targets").disabled, true); // Synthetic audio never qualifies for import.
  $("save-workflow").click(); await until(() => local.values.size === 1);
  const saved = JSON.parse([...local.values.values()][0]); assert.equal(saved[0].workflow, "make-variation");
  assert.equal(submissions.length, 2); assert.ok(!JSON.stringify(saved).includes("parent_generation_id"));
});
