import { cleanProject, demoProject, PROJECT_SCHEMA, PROJECT_LIMITS } from "./project-context.mjs";
import { createAbletonImportUi } from "./ableton-import.js";

const $ = id => document.getElementById(id);
let draft = demoProject();
let config;
let trackIndex = 0;
let clipIndex = 0;
let busy = false;
let importUi;
const status = message => { $("project-status").textContent = message; };
function option(value, label) { const node = document.createElement("option"); node.value = value; node.textContent = label; return node; }
function resetReview() { $("context-review").hidden = true; $("continue-generation").removeAttribute("href"); }
function edited() { resetReview(); renderTimeline(); status("Local draft updated. Review context again before continuing. No Live or MWA project edits were sent."); }
function replace(next, message) {
  draft = cleanProject(next); trackIndex = 0; clipIndex = 0;
  resetReview(); render(); status(message);
}
async function api(path, body) {
  if (!config) throw new Error("The local starter is still connecting.");
  const response = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: { "X-Starter-CSRF": config.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "Could not complete the local request.");
  return data;
}
async function run(action) {
  if (busy) return;
  busy = true;
  importUi?.setBusy(true);
  for (const id of ["load-demo", "capture-ableton", "load-generation", "download-project", "prepare-context"]) $(id).disabled = true;
  const controls = [...document.querySelectorAll("#project-workspace input, #project-workspace select, #handoff-form textarea, #handoff-form input")];
  const previous = controls.map(control => control.disabled);
  controls.forEach(control => { control.disabled = true; });
  try { await action(); } catch (error) { status(error.message); }
  finally {
    busy = false;
    importUi?.setBusy(false);
    $("load-demo").disabled = false; $("download-project").disabled = false; $("prepare-context").disabled = !config;
    $("project-file").disabled = false;
    controls.forEach((control, index) => { control.disabled = previous[index]; });
    renderTrack();
    $("capture-ableton").disabled = !config?.abletonReaderAvailable;
    $("load-generation").disabled = !$("mwa-generation").value;
  }
}
function renderTimeline() {
  const ns = "http://www.w3.org/2000/svg";
  const element = (name, attributes, content) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    if (content !== undefined) node.textContent = content;
    return node;
  };
  const end = Math.max(32, ...draft.tracks.flatMap(track => track.clips.map(clip => clip.start_beats + clip.length_beats)));
  const height = 38 + draft.tracks.length * 48;
  const svg = element("svg", { viewBox: `0 0 900 ${height}`, role: "img", "aria-label": `Arrangement draft: ${draft.tracks.length} tracks, ${Math.round(end)} beats. Edit timing in the labeled clip controls below.` });
  for (let step = 0; step <= 8; step++) {
    const x = 190 + step * 85;
    svg.append(element("line", { x1: x, y1: 30, x2: x, y2: height, class: "timeline-grid" }), element("text", { x, y: 19, class: "timeline-beat" }, String(Math.round(end * step / 8))));
  }
  draft.tracks.forEach((track, index) => {
    const group = element("g", { class: `timeline-track-${track.kind}${track.muted ? " timeline-muted" : ""}` });
    const title = element("text", { x: 12, y: 62 + index * 48, class: "timeline-name" }, `${track.selected ? "●" : "○"} ${track.name.slice(0, 22)}`);
    title.append(element("title", {}, `${track.name} · ${track.kind}${track.selected ? " · included in context" : " · excluded from context"}`));
    group.append(title);
    track.clips.forEach(clip => {
      const x = 190 + clip.start_beats / end * 680;
      const width = Math.max(1, clip.length_beats / end * 680);
      const box = element("rect", { x, y: 40 + index * 48, width, height: 31, rx: 5, class: "timeline-clip" });
      box.append(element("title", {}, `${clip.name}: beat ${clip.start_beats}, ${clip.length_beats} beats`)); group.append(box);
      if (width > 65) group.append(element("text", { x: x + 8, y: 60 + index * 48, class: "timeline-clip-label" }, clip.name.slice(0, Math.max(1, Math.floor(width / 7) - 3))));
    });
    svg.append(group);
  });
  $("project-timeline").replaceChildren(svg);
}
function renderClip() {
  const clips = draft.tracks[trackIndex].clips;
  const clip = clips[clipIndex];
  $("edit-clip").replaceChildren(...clips.map((item, index) => option(String(index), item.name)));
  $("edit-clip").value = String(clipIndex);
  for (const id of ["edit-clip", "clip-name", "clip-start", "clip-length"]) $(id).disabled = !clip;
  $("clip-name").value = clip?.name ?? ""; $("clip-start").value = clip?.start_beats ?? ""; $("clip-length").value = clip?.length_beats ?? "";
  $("clip-note").textContent = clip ? "Timing metadata only. No audio files, MIDI note editing, device processing or Live write-back." : "This track has no captured arrangement clips. Session clips are outside this example's scope.";
}
function renderTrack() {
  const track = draft.tracks[trackIndex];
  $("edit-track").replaceChildren(...draft.tracks.map((item, index) => option(String(index), `${item.name} · ${item.kind}`)));
  $("edit-track").value = String(trackIndex);
  $("track-name").value = track.name; $("track-muted").checked = track.muted; $("track-selected").checked = track.selected;
  $("track-volume").value = track.volume_normalized ?? ""; $("track-pan").value = track.pan ?? "";
  $("track-volume").disabled = track.volume_normalized === undefined; $("track-pan").disabled = track.pan === undefined;
  $("track-devices").textContent = track.devices.length ? `Top-level device labels: ${track.devices.join(", ")}. No presets or processing code.` : "No device labels captured.";
  renderClip();
}
function render() {
  $("project-title").value = draft.title; $("project-tempo").value = draft.tempo;
  $("project-source").textContent = `${draft.source.toUpperCase()} / LOCAL DRAFT`;
  renderTimeline(); renderTrack();
}
function updateDraft(change) {
  try { const next = structuredClone(draft); change(next); draft = cleanProject(next); edited(); }
  catch (error) { status(error.message); }
}
$("project-settings").addEventListener("submit", event => event.preventDefault());
$("project-settings").addEventListener("change", () => {
  if (!$("project-settings").reportValidity()) return;
  updateDraft(next => { next.title = $("project-title").value; next.tempo = Number($("project-tempo").value); });
});
$("edit-track").addEventListener("change", () => { trackIndex = Number($("edit-track").value); clipIndex = 0; renderTrack(); });
$("edit-clip").addEventListener("change", () => { clipIndex = Number($("edit-clip").value); renderClip(); });
$("track-settings").addEventListener("submit", event => event.preventDefault());
$("track-settings").addEventListener("change", event => {
  if (event.target.id === "edit-track" || !$("track-settings").reportValidity()) return;
  updateDraft(next => {
    const track = next.tracks[trackIndex]; track.name = $("track-name").value; track.muted = $("track-muted").checked; track.selected = $("track-selected").checked;
    if (!$("track-volume").disabled) track.volume_normalized = Number($("track-volume").value);
    if (!$("track-pan").disabled) track.pan = Number($("track-pan").value);
  });
  $("edit-track").options[trackIndex].textContent = `${draft.tracks[trackIndex].name} · ${draft.tracks[trackIndex].kind}`;
});
$("clip-settings").addEventListener("submit", event => event.preventDefault());
$("clip-settings").addEventListener("change", event => {
  if (event.target.id === "edit-clip" || !$("clip-settings").reportValidity()) return;
  updateDraft(next => { const clip = next.tracks[trackIndex].clips[clipIndex]; clip.name = $("clip-name").value; clip.start_beats = Number($("clip-start").value); clip.length_beats = Number($("clip-length").value); });
  $("edit-clip").options[clipIndex].textContent = draft.tracks[trackIndex].clips[clipIndex].name;
});
function clearGeneration() { importUi?.setGeneration(null); $("open-mwa-studio").hidden = true; $("project-audio").pause(); $("project-audio").removeAttribute("src"); $("project-audio").hidden = true; $("generation-note").hidden = true; }
$("load-demo").addEventListener("click", () => { clearGeneration(); replace(demoProject(), "Original synthetic demo draft. No Ableton read, hosted request or API credits used."); });
$("project-file").addEventListener("change", () => run(async () => {
  const file = $("project-file").files[0]; if (!file) return;
  if (file.size > PROJECT_LIMITS.bytes) throw new Error("Draft JSON must be at most 256 KiB.");
  const input = JSON.parse(await file.text());
  const result = await api("/api/project/clean", { project: input });
  clearGeneration(); replace(result.project, "Draft imported and cleaned on the local starter. Unknown fields were discarded. Nothing was sent to hosted MWA.");
  $("project-file").value = "";
}));
$("capture-ableton").addEventListener("click", () => run(async () => {
  status("Reading a bounded snapshot. Keep the Live Set idle; no Live writes are requested.");
  const result = await api("/api/project/capture", {});
  clearGeneration(); replace(result.project, `Ableton observational draft captured; this is not an atomic sync baseline.${result.warnings.length ? ` Some fields are unavailable: ${result.warnings.join(", ")}.` : ""} Review before sharing context.`);
}));
$("download-project").addEventListener("click", () => {
  const blob = new Blob([`${JSON.stringify(cleanProject(draft), null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "mwa-public-project-draft.json"; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); status("Clean draft export requested. This JSON is not an .als file or a synced MWA Studio project.");
});
$("mwa-generation").addEventListener("change", () => { $("load-generation").disabled = !$("mwa-generation").value; });
async function loadGeneration(id) {
  const job = await api(`/api/generations/${id}`);
  if (job.audio.status !== "ready" || !job.audio.url) throw new Error("Choose a generation with ready audio, or continue checking it in the playground.");
  clearGeneration();
  replace({ schema_version: PROJECT_SCHEMA, source: job.demo ? "demo" : "mwa", title: job.title, tempo: 128, tracks: [{ id: "full-audio", name: "Full-track audio", kind: "audio", clips: [{ name: job.title, start_beats: 0, length_beats: (job.demo ? 15 : 180) * 128 / 60 }] }] }, "Audio project draft loaded. The source project's multitrack contents are not copied here.");
  if (job.studioUrl) { $("open-mwa-studio").href = job.studioUrl; $("open-mwa-studio").hidden = false; }
  $("project-audio").src = job.audio.url; $("project-audio").hidden = false; $("generation-note").hidden = job.demo;
  importUi?.setGeneration(job);
}
$("load-generation").addEventListener("click", () => run(() => loadGeneration($("mwa-generation").value)));
for (const id of ["project-intent", "include-names"]) $(id).addEventListener("input", resetReview);
$("handoff-form").addEventListener("submit", event => {
  event.preventDefault();
  if (!["handoff-form", "project-settings", "track-settings", "clip-settings"].every(id => $(id).reportValidity())) return;
  run(async () => {
    status("Preparing selected context on the local server. No hosted MWA request.");
    const result = await api("/api/project/handoff", { project: draft, includeNames: $("include-names").checked, intent: $("project-intent").value });
    $("context-json").textContent = JSON.stringify(result.context, null, 2); $("context-prompt").textContent = result.prompt;
    $("continue-generation").href = `/?project=${result.id}#studio`; $("context-review").hidden = false;
    status("Cleaned context is ready to review. Continue to the playground to explicitly submit a generation.");
  });
});
render();
try {
  const response = await fetch("/api/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not connect to the local starter.");
  config = await response.json();
  importUi = createAbletonImportUi({ config, api, runAction: run, announce: status });
  $("capture-ableton").disabled = !config.abletonReaderAvailable;
  $("project-api-access").href = config.apiAccessUrl;
  $("reader-note").textContent = config.abletonReaderAvailable ? "Reader enabled. Only an explicit capture reads Live. Close other connectors using the upstream script before capture." : "Run npm run ableton after the optional setup to enable reading. JSON import and demo editing are available now.";
  $("mwa-generation").append(...config.recent.map(job => option(job.id, job.title)));
  status("Original demo draft ready. Edits stay in memory; export to keep them. No audio is produced by draft editing.");
  const id = new URL(location.href).searchParams.get("generation");
  if (id && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) await run(() => loadGeneration(id));
} catch (error) { status(error.message); $("prepare-context").disabled = true; }
