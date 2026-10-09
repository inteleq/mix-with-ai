import { WORKFLOW_CARDS, WORKFLOW_GENRES, defaultTemplate, cleanWorkflowTemplate, cleanLesson, encodeLesson, decodeLesson } from "./workflow-templates.mjs";
import { createComparisonPlayer } from "./comparison.js";
import { createAbletonImportUi } from "./ableton-import.js";
import { isGenerationBusy, hasPlayableAudio } from "./generation-state.js";

const $ = id => document.getElementById(id);
const storageKey = "mwa-workflow-preferences-v1";
const pendingKey = "mwa-workflow-pending-v1";
let config, readiness, importer, lesson, current, polling, pending;
let selected = "create-idea", busy = false, activeId = null, importSelection = null;
let history = [], saved = [], publicExamples = [];
const note = message => { $("workflow-status").textContent = message; };
function showError(error) { $("workflow-error").textContent = error.message || String(error); $("workflow-error").hidden = false; }
function clearError() { $("workflow-error").hidden = true; }
const comparison = createComparisonPlayer($("workflow-compare-audio"), {
  onState: ({ active, track }) => {
    $("compare-original").setAttribute("aria-pressed", String(active === "A"));
    $("compare-variation").setAttribute("aria-pressed", String(active === "B"));
    if (track) $("workflow-compare-note").textContent = `${active === "A" ? "Original" : "Variation"}: ${track.title}. ${track.demo ? "Synthesized preview, not MWA-generated music." : "MWA audio."}`;
  },
  onError: message => { $("workflow-compare-note").textContent = message; },
});
function rememberPending(value) {
  pending = value;
  try { value ? sessionStorage.setItem(pendingKey, JSON.stringify(value)) : sessionStorage.removeItem(pendingKey); } catch { /* In-memory recovery remains available. */ }
}
try {
  const stored = localStorage.getItem(storageKey);
  if (stored && stored.length <= 60000) {
    const values = JSON.parse(stored);
    if (Array.isArray(values) && values.length <= 12) saved = values.map(cleanWorkflowTemplate);
  }
} catch { saved = []; }
try {
  const stored = sessionStorage.getItem(pendingKey);
  if (stored && stored.length < 8192) {
    const value = JSON.parse(stored);
    if (typeof value.key === "string" && /^[a-f0-9-]{36}$/i.test(value.key)) pending = { key: value.key, body: { template: cleanWorkflowTemplate(value.body.template), ...(value.body.parent_generation_id ? { parent_generation_id: value.body.parent_generation_id } : {}) } };
  }
} catch { pending = null; }
async function api(path, body, { key, signal } = {}) {
  let response;
  try {
    response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", signal,
      headers: { "X-Starter-CSRF": config.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error("Connection interrupted. Recover the same request before starting another run."), { retryable: true });
  }
  let data;
  try { data = await response.json(); } catch { throw Object.assign(new Error("The response could not be read. Keep the existing request for recovery."), { retryable: true }); }
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "The request could not be completed."), { status: response.status, retryable: data.error?.retryable || response.status >= 500 || response.status === 429 });
  return data;
}
function template() { return cleanWorkflowTemplate({ schema_version: "mwa_workflow_template_v1", workflow: selected, name: $("workflow-name").value, genre: $("workflow-genre").value, prompt: $("workflow-prompt").value }); }
function requestBody() { return { template: template(), ...(selected === "make-variation" ? { parent_generation_id: $("workflow-parent").value } : {}) }; }
function update() {
  const locked = busy || Boolean(activeId) || Boolean(pending);
  const isImport = selected === "bring-to-ableton";
  $("run-workflow").disabled = !readiness?.generation.allowed || locked || isImport || !$("run-consent").checked || selected === "make-variation" && !$("workflow-parent").value;
  $("run-workflow").hidden = isImport || config?.mode === "live";
  $("run-consent-label").hidden = isImport || config?.mode === "live";
  $("developer-handoff").hidden = isImport || config?.mode !== "live";
  $("developer-handoff").disabled = locked || selected === "make-variation" && !$("workflow-parent").value;
  $("retry-workflow").hidden = !pending;
  $("retry-workflow").disabled = busy || config?.mode !== "demo";
  $("cancel-workflow").hidden = !activeId;
  $("cancel-workflow").disabled = busy;
  $("refresh-result").disabled = busy || !current;
  $("use-variation").disabled = locked || !current || !hasPlayableAudio(current);
  $("refresh-readiness").disabled = !config || busy;
  for (const id of ["workflow-name", "workflow-genre", "workflow-prompt", "workflow-parent", "workflow-results", "workflow-file", "load-workflow", "delete-workflow", "save-workflow"]) $(id).disabled = locked;
  document.querySelectorAll(".workflow-card").forEach(button => { button.disabled = locked; });
  importer?.setBusy(locked);
}
async function action(task) {
  if (busy) return;
  clearError(); busy = true; update();
  try { await task(); } catch (error) { showError(error); } finally { busy = false; update(); }
}
function renderSaved() {
  const first = document.createElement("option"); first.value = ""; first.textContent = saved.length ? "Choose my workflow" : "No saved workflows";
  $("saved-workflows").replaceChildren(first, ...saved.map((item, index) => { const option = document.createElement("option"); option.value = String(index); option.textContent = item.name; return option; }));
}
function showExample() {
  const requested = lesson?.example_id;
  const chosen = requested ? publicExamples.find(item => item.id === requested && item.source === "mwa_api") : publicExamples.find(item => item.source === "mwa_api" && item.genre === $("workflow-genre").value) || publicExamples.find(item => item.source === "mwa_api");
  const fallback = publicExamples.find(item => item.id === (selected === "make-variation" ? "demo-after-hours-variation" : "demo-after-hours"));
  const example = chosen || fallback;
  $("example-audio").pause();
  if (example) $("example-audio").src = example.audioUrl; else $("example-audio").removeAttribute("src");
  $("example-audio").hidden = !example;
  $("example-title").textContent = example?.title || "Example unavailable";
  $("example-note").textContent = chosen ? "Publication-approved MWA audio from the public showcase." : `${requested ? "The lesson's approved example is not published here. " : "Approved MWA examples are awaiting publication. "}This is an original 15-second synthesized listening demo; it is not MWA-generated music and does not follow the workflow prompt.`;
  $("example-credit").textContent = chosen ? chosen.credit : example ? "Original MWA Music Starter demo synthesizer." : "Add approved audio through showcase.json.";
}
function selectTemplate(value) {
  const clean = cleanWorkflowTemplate(value);
  selected = clean.workflow;
  $("workflow-name").value = clean.name; $("workflow-genre").value = clean.genre; $("workflow-prompt").value = clean.prompt;
  $("run-consent").checked = false;
  $("generation-preferences").hidden = selected === "bring-to-ableton";
  $("parent-choice").hidden = selected !== "make-variation";
  document.querySelectorAll(".workflow-card").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.workflow === selected)));
  $("workflow-cost").textContent = selected === "bring-to-ableton" ? "Placement makes no new MWA generation request. Use a ready result and explicitly review the local audio import." : config?.mode === "live" ? "Price unavailable · guided live generation is blocked. API credits are separate from app credits." : "Cost: 0 API credits · local synthesized preview only.";
  $("run-gate").textContent = selected === "bring-to-ableton" ? "Choose a ready live result below and follow Review → Ableton. Import remains disabled until the optional adapter is explicitly enabled." : config?.mode === "live" ? "Account access, balance and a server price quote are not connected to this example. Developers can review the request separately; opening it does not spend credits." : "Review your choices, acknowledge the preview, then run. Changing preferences makes no API request.";
  showExample(); update();
}
function loadLesson(value) {
  lesson = cleanLesson(value);
  selectTemplate(lesson.template);
  $("lesson-context").hidden = false;
  $("lesson-heading").textContent = lesson.title;
  $("lesson-attribution").textContent = `Shared by ${lesson.teacher} · attribution supplied by the link author`;
  $("lesson-objective").textContent = lesson.objective;
  note("Lesson preferences loaded. Review and customise them; nothing was run or saved.");
}
function renderChecks() {
  const rows = [
    ["MWA Desktop", "Use the existing installer and setup. This public example has not paired with the private Desktop bridge."],
    ["Account", "Sign in within MWA Desktop. This example cannot verify your account session."],
    ["Access & credits", readiness.mode === "demo" ? "Preview needs neither an account nor credits. Live pricing and trial eligibility are checked by MWA, not a lesson link." : "Server API key configured. Access, balance and price are unverified; guided live runs are blocked."],
    ["Ableton connection", readiness.ableton.status === "enabled_unverified" ? "Optional public adapter enabled. Explicitly inspect the saved Set and empty tracks below. Real Live acceptance is pending." : "Optional public adapter is off. You can explore and listen without Ableton."],
  ];
  $("setup-checks").replaceChildren(...rows.map(([title, description]) => { const li = document.createElement("li"); const strong = document.createElement("strong"); strong.textContent = title; const span = document.createElement("span"); span.textContent = description; li.append(strong, span); return li; }));
}
function resultOptions() {
  const resultValue = $("workflow-results").value;
  const parentValue = $("workflow-parent").value;
  const option = (value, label) => { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; };
  $("workflow-results").replaceChildren(option("", "Choose a session result"), ...history.map(item => option(item.id, item.title || "Untitled track")));
  $("workflow-results").value = current?.generation_id || resultValue;
  $("workflow-parent").replaceChildren(option("", "Choose a ready original"), ...history.filter(item => item.ready).map(item => option(item.id, item.title || "Untitled track")));
  $("workflow-parent").value = parentValue;
}
function link(id, url) { $(id).hidden = !url; if (url) $(id).href = url; else $(id).removeAttribute("href"); }
async function render(job) {
  const changed = current?.generation_id !== job.generation_id;
  current = job;
  const metadata = history.find(item => item.id === job.generation_id);
  if (metadata) metadata.ready = hasPlayableAudio(job);
  activeId = isGenerationBusy(job) ? job.generation_id : null;
  $("result-title").textContent = job.title;
  $("result-source").textContent = job.demo ? "LOCAL SYNTHESIZED PREVIEW" : "MWA API RESULT";
  $("result-note").textContent = job.error?.message || (hasPlayableAudio(job) ? job.demo ? "15-second preview ready. It does not follow your prompt. Make a variation to explore the A/B journey." : "Full audio ready. Listen, open the original in MWA, or review an Ableton import. Refresh expired links before using them." : isGenerationBusy(job) ? `${job.stage.replaceAll("_", " ")} · ${Math.round(job.progress * 100)}%` : `${job.status.replaceAll("_", " ")} · audio ${job.audio.status}. Refresh status or open the saved MWA project if available.`);
  $("workflow-progress").hidden = !activeId; $("workflow-progress").value = job.progress;
  if (changed) { $("result-audio").pause(); $("result-audio").removeAttribute("src"); }
  $("result-audio").hidden = !hasPlayableAudio(job);
  if (hasPlayableAudio(job) && $("result-audio").getAttribute("src") !== job.audio.url) $("result-audio").src = job.audio.url;
  link("result-download", hasPlayableAudio(job) ? job.audio.url : null); link("result-studio", job.studioUrl);
  const importKey = `${job.generation_id}:${!job.demo && hasPlayableAudio(job)}`;
  if (importSelection !== importKey) { importer.setGeneration(job); importSelection = importKey; }
  resultOptions(); update();
  if (hasPlayableAudio(job) && job.parentId) {
    try {
      const parent = await api(`/api/generations/${job.parentId}`);
      if (current?.generation_id !== job.generation_id || !hasPlayableAudio(parent)) return;
      comparison.setPair({ title: parent.title, audioUrl: parent.audio.url, demo: parent.demo }, { title: job.title, audioUrl: job.audio.url, demo: job.demo });
      $("workflow-comparison").hidden = false;
    } catch { $("workflow-compare-note").textContent = "The original is unavailable. Refresh the result to try loading the pair again."; }
  } else if (changed) { $("workflow-comparison").hidden = true; comparison.setPair(null, null); }
}
async function watch(id) {
  polling?.abort();
  const controller = new AbortController(); polling = controller;
  const started = Date.now();
  while (!controller.signal.aborted) {
    try {
      const job = await api(`/api/generations/${id}`, undefined, { signal: controller.signal });
      if (controller.signal.aborted) return;
      await render(job);
      if (!isGenerationBusy(job)) { note(hasPlayableAudio(job) ? "Your result is ready. Listen before choosing the next step." : $("result-note").textContent); return; }
    } catch (error) {
      if (!controller.signal.aborted) showError(error);
      return; // Refresh is explicit; this never submits a replacement generation.
    }
    if (Date.now() - started > 15 * 60_000) { note("The job may still be running. Refresh its status; do not submit a replacement."); return; }
    await new Promise(resolve => {
      const timer = setTimeout(done, config.mode === "demo" ? 500 : 3000);
      function done() { clearTimeout(timer); controller.signal.removeEventListener("abort", done); resolve(); }
      controller.signal.addEventListener("abort", done, { once: true });
      if (controller.signal.aborted) done();
    });
  }
}
async function run(request) {
  rememberPending(request); update();
  try {
    const job = await api("/api/workflows/run", request.body, { key: request.key });
    rememberPending(null);
    history = [{ id: job.generation_id, title: request.body.template.name, genre: request.body.template.genre, prompt: request.body.template.prompt }, ...history.filter(item => item.id !== job.generation_id)];
    await render(job); note("Listening preview started. No MWA credits used."); watch(job.generation_id);
  } catch (error) {
    if (!error.retryable) rememberPending(null);
    throw error;
  }
}
function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function teacherLesson() {
  if (!$("lesson-form").reportValidity()) return null;
  return cleanLesson({ schema_version: "mwa_workflow_lesson_v1", title: $("lesson-title").value, teacher: $("lesson-teacher").value, objective: $("lesson-goal").value, template: template(), ...(lesson?.example_id ? { example_id: lesson.example_id } : {}) });
}

$("workflow-genre").replaceChildren(...WORKFLOW_GENRES.map(genre => { const option = document.createElement("option"); option.value = genre; option.textContent = genre.replaceAll("_", " "); return option; }));
$("workflow-cards").replaceChildren(...WORKFLOW_CARDS.map((card, index) => {
  const button = document.createElement("button"); button.type = "button"; button.className = "workflow-card"; button.dataset.workflow = card.id; button.setAttribute("aria-pressed", String(index === 0));
  const number = document.createElement("span"); number.className = "eyebrow"; number.textContent = `0${index + 1} / WORKFLOW`;
  const title = document.createElement("h3"); title.textContent = card.name;
  const description = document.createElement("p"); description.textContent = card.description;
  const output = document.createElement("small"); output.textContent = card.output;
  const cost = document.createElement("small"); cost.className = "workflow-card-cost"; cost.textContent = card.id === "bring-to-ableton" ? "Uses an existing ready result" : "Preview: 0 credits · live price unavailable";
  button.append(number, title, description, output, cost);
  button.addEventListener("click", () => { if (busy || activeId || pending) return; selectTemplate(defaultTemplate(card.id)); $(card.id === "bring-to-ableton" ? "listen" : "workflow-name").focus?.(); $(card.id === "bring-to-ableton" ? "listen" : "customise").scrollIntoView(); });
  return button;
}));
$("workflow-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!readiness?.generation.allowed || busy || activeId || pending || selected === "bring-to-ableton" || !$("run-consent").checked || !$("workflow-form").reportValidity()) return;
  action(async () => {
    const body = requestBody();
    const prepared = await api("/api/workflows/prepare", body);
    if (!prepared.allowed || prepared.cost.status !== "preview" || prepared.cost.credits !== 0) throw new Error("No verified preview cost is available. Nothing was run.");
    await run({ body, key: crypto.randomUUID() });
  });
});
$("retry-workflow").addEventListener("click", () => { if (pending && config.mode === "demo") action(() => run(pending)); });
$("run-consent").addEventListener("change", update); $("workflow-parent").addEventListener("change", update); $("workflow-genre").addEventListener("change", showExample);
$("developer-handoff").addEventListener("click", () => action(async () => { const result = await api("/api/workflows/handoff", requestBody()); location.assign(result.url); }));
$("refresh-readiness").addEventListener("click", () => action(async () => { readiness = await api("/api/workflows/readiness"); renderChecks(); note(readiness.generation.message); }));
$("workflow-results").addEventListener("change", () => { if (!$("workflow-results").value) return; clearError(); watch($("workflow-results").value); });
$("refresh-result").addEventListener("click", () => { if (current) { clearError(); watch(current.generation_id); } });
$("cancel-workflow").addEventListener("click", () => action(async () => { if (activeId) { const job = await api(`/api/generations/${activeId}/cancel`, {}); polling?.abort(); await render(job); } }));
$("use-variation").addEventListener("click", () => { if (!current || !hasPlayableAudio(current)) return; selectTemplate({ ...defaultTemplate("make-variation"), genre: current.genre || "deep_house" }); $("workflow-parent").value = current.generation_id; update(); $("workflow-prompt").focus(); });
$("compare-original").addEventListener("click", () => comparison.switchTo("A")); $("compare-variation").addEventListener("click", () => comparison.switchTo("B"));
document.addEventListener("play", event => { if (event.target.tagName === "AUDIO") document.querySelectorAll("audio").forEach(player => { if (player !== event.target) player.pause(); }); }, true);
for (const id of ["result-audio", "example-audio"]) $(id).addEventListener("error", () => { if ($(id).getAttribute("src")) showError(new Error("Audio could not load. Refresh the result or choose another example.")); });
$("save-workflow").addEventListener("click", () => action(async () => {
  const value = template();
  const index = saved.findIndex(item => item.name === value.name && item.workflow === value.workflow);
  const next = [...saved];
  if (index >= 0) next[index] = value;
  else { if (next.length >= 12) throw new Error("You can keep twelve workflows here. Export or delete one before saving another."); next.push(value); }
  localStorage.setItem(storageKey, JSON.stringify(next)); saved = next; renderSaved(); note("Preferences saved on this browser. No cloud upload or generation.");
}));
$("load-workflow").addEventListener("click", () => action(async () => { const index = $("saved-workflows").value; if (index !== "" && saved[Number(index)]) { selectTemplate(saved[Number(index)]); note("Saved preferences loaded. Nothing was run."); } }));
$("delete-workflow").addEventListener("click", () => action(async () => { const index = $("saved-workflows").value; if (index === "") return; const next = saved.filter((_, i) => i !== Number(index)); localStorage.setItem(storageKey, JSON.stringify(next)); saved = next; renderSaved(); note("Saved preferences deleted from this browser."); }));
$("export-workflow").addEventListener("click", () => action(async () => { downloadJson(template(), "mwa-workflow.json"); note("Template download requested. It contains your name, genre and prompt."); }));
$("workflow-file").addEventListener("change", () => action(async () => {
  const file = $("workflow-file").files[0]; if (!file) return;
  if (file.size > 8192) throw new Error("Use a template or lesson JSON file under 8 KiB.");
  const value = JSON.parse(await file.text());
  value.schema_version === "mwa_workflow_lesson_v1" ? loadLesson(value) : selectTemplate(cleanWorkflowTemplate(value));
  $("workflow-file").value = ""; note("Preferences loaded from JSON. Review them before saving or running.");
}));
$("lesson-form").addEventListener("submit", event => { event.preventDefault(); action(async () => { const value = teacherLesson(); if (!value) return; const url = new URL("/workflows", location.origin); url.hash = `lesson=${encodeLesson(value)}`; $("lesson-link").value = url.href; $("lesson-share").hidden = false; note("Lesson link prepared. It includes the prompt and grants no trial credits."); }); });
$("export-lesson").addEventListener("click", () => action(async () => { const value = teacherLesson(); if (value) downloadJson(value, "mwa-workflow-lesson.json"); }));
$("copy-lesson").addEventListener("click", () => action(async () => { try { await navigator.clipboard.writeText($("lesson-link").value); note("Lesson link copied. Nothing was posted."); } catch { $("lesson-link").focus(); $("lesson-link").select(); note("Copy the selected lesson link."); } }));
$("clear-lesson").addEventListener("click", () => { lesson = null; $("lesson-context").hidden = true; window.history.replaceState(null, "", location.pathname); showExample(); note("Lesson attribution cleared. Your current preferences remain local."); });
window.addEventListener("hashchange", () => { if (busy || activeId || pending) { note("Finish or recover the current run before opening another lesson."); return; } if (location.hash.startsWith("#lesson=")) { try { loadLesson(decodeLesson(location.hash.slice(8))); } catch (error) { showError(error); } } });
renderSaved(); selectTemplate(defaultTemplate());
try {
  if (location.protocol === "file:") throw new Error("Open /workflows from the running local kit or hosted preview. Opening the HTML file directly cannot connect to its server.");
  const response = await fetch("/api/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not connect to the local example. Reload to retry.");
  config = await response.json(); history = config.recent;
  readiness = await api("/api/workflows/readiness");
  importer = createAbletonImportUi({ config, api: (path, body) => api(path, body), runAction: action, announce: note });
  $("workflow-mode").textContent = config.mode === "demo" ? "PUBLIC LISTENING PREVIEW" : "DEVELOPER LIVE CONFIGURATION";
  $("preview-explanation").textContent = readiness.generation.message;
  $("mwa-account").href = config.appUrl;
  if (config.repositoryUrl) $("workflow-github").href = config.repositoryUrl;
  // Replace developer commands in the musician-facing status; detailed setup stays in docs.
  $("import-enable-note").textContent = config.abletonImportAvailable ? "Optional public import adapter enabled. Explicitly inspect Live before preparing any placement. Private MWA Desktop compatibility and real Live acceptance are pending." : "The optional public import adapter is off. Developer setup is in the integration guide. This is not a verified connection to private MWA Desktop.";
  renderChecks(); resultOptions(); selectTemplate(defaultTemplate());
  try { const examples = await fetch("/api/showcase"); if (!examples.ok) throw new Error(); const data = await examples.json(); publicExamples = [...data.tracks, ...data.comparisonDemos]; showExample(); }
  catch { $("example-note").textContent = "Examples could not load. You can still customise a workflow; reload to try again."; }
  if (pending) { selectTemplate(pending.body.template); note("A previous preview request needs recovery. Use Recover the same request; no new run was submitted."); }
  else if (location.hash.startsWith("#lesson=")) loadLesson(decodeLesson(location.hash.slice(8)));
  else note("Choose a workflow. No generation or Ableton request has been made.");
  update();
} catch (error) { $("workflow-mode").textContent = "SETUP NEEDED"; showError(error); }
