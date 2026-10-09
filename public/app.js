import { buildCodeExamples } from "./code-examples.js";
import { choosePair, createComparisonPlayer } from "./comparison.js";
import { buildShareDetails, drawShareCard } from "./share-card.js";
import { isGenerationBusy, hasPlayableAudio } from "./generation-state.js";

const $ = id => document.getElementById(id);
const form = $("generation-form");
const audio = $("audio-player");
const terminal = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);
const presets = {
  night: { title: "After hours", genre: "tech_house", prompt: "A late-night tech house track with a rolling bassline, crisp percussion, a spacious breakdown, and a punchy final drop. Instrumental." },
  warm: { title: "Golden hour", genre: "deep_house", prompt: "A warm deep house track with soft chords, a rounded bass groove, gentle percussion, and an airy sunset atmosphere. Instrumental, with a relaxed breakdown." },
  peak: { title: "One more night", genre: "trance", prompt: "An energetic trance track with a driving bassline, bright arpeggios, a wide emotional breakdown, and an uplifting final drop. Instrumental." },
};
let config;
let current;
let currentInput;
let revision;
let history = [];
let polling;
let submitting = false;
let activeId = null;
let retryExportKey;
let pending;
let exampleKey = crypto.randomUUID();
let exampleFingerprint = "";
let codeLanguage = "javascript";
let examples;
let shareTrack;
const comparisonTracks = new Map();
const parentsLoading = new Set();
let comparisonPair = {};
const comparison = createComparisonPlayer($("comparison-audio"), {
  onState: ({ active, track }) => {
    for (const side of ["A", "B"]) $("listen-" + side.toLowerCase()).setAttribute("aria-pressed", String(active === side));
    if (track) $("comparison-note").textContent = `${active}: ${track.title}. ${track.source === "starter_demo" ? "Original synthesized demo, not an MWA generation." : "MWA audio."} Switching preserves the time position, clamped for shorter tracks.`;
  },
  onError: message => { $("comparison-note").textContent = message; },
});
try { pending = JSON.parse(sessionStorage.getItem("mwa-starter-pending") || "null"); } catch { pending = null; }
if (pending && (!pending.input || typeof pending.key !== "string")) pending = null;

function event(name, detail = {}) {
  // An extension point, not an analytics service. No network request or prompts.
  window.dispatchEvent(new CustomEvent("mwa:starter", { detail: { name, mode: config?.mode, ...detail } }));
}
function pendingSave(value) {
  pending = value;
  try { value ? sessionStorage.setItem("mwa-starter-pending", JSON.stringify(value)) : sessionStorage.removeItem("mwa-starter-pending"); } catch { /* In-memory retry remains available. */ }
}
function showError(message, canRetry = false) {
  $("error-message").textContent = message;
  $("error-panel").hidden = false;
  $("retry-submit").hidden = !canRetry;
}
function clearError() { $("error-panel").hidden = true; $("retry-submit").hidden = true; }
function announce(message) { $("status-announcement").textContent = message; }
function updateSetup() {
  $("setup-preview-status").textContent = config?.mode === "demo" ? "Preview ready · no API credits used." : "Preview is optional; this starter is configured for live requests.";
  $("setup-key-status").textContent = config?.mode === "live" ? current && !current.demo ? "MWA job returned for this session." : "Server key configured · access still needs verification." : "Run the local setup wizard to connect your key.";
  $("setup-track-status").textContent = current && !current.demo && hasPlayableAudio(current) ? "MWA audio ready · listen and download." : "A ready live track will confirm this step.";
}
function updateShareCard() {
  if (!shareTrack) return;
  try {
    const details = buildShareDetails({ ...shareTrack, title: $("share-track-title").value, campaign: config?.campaign, includePrompt: $("share-include-prompt").checked });
    $("share-caption").value = details.caption;
    drawShareCard($("share-canvas"), details);
    $("share-canvas").setAttribute("aria-label", `${details.title}, ${details.genre}. ${details.source}. ${details.prompt ? `Prompt: ${details.prompt}. ` : ""}Build with the MWA API at mixwithai.com.`);
    $("download-share-card").disabled = false;
  } catch {
    $("download-share-card").disabled = true;
    $("share-feedback").textContent = "Card rendering is unavailable. You can copy the caption instead.";
  }
}
function updateButtons() {
  const busy = submitting || Boolean(activeId) || Boolean(pending);
  $("generate").disabled = !config || busy;
  $("generate-label").textContent = submitting ? "Sending your request…" : activeId ? (config?.mode === "demo" ? "Previewing workflow…" : "Making your music…") : config?.mode === "live" ? (revision ? `Generate ${revision.kind}` : "Generate music") : "Preview the workflow";
  $("retry-submit").disabled = submitting;
  $("variation").disabled = busy;
  $("remix").disabled = busy;
  $("clear-revision").disabled = busy;
}
function updateCount() {
  const bytes = new TextEncoder().encode($("prompt").value.trim()).length;
  $("prompt-count").textContent = `${bytes} / 1500 bytes`;
  $("prompt").setCustomValidity(bytes > 1500 ? "Keep the prompt under 1500 UTF-8 bytes." : "");
  updateCodeExamples();
}
function formInput() {
  return { prompt: $("prompt").value.trim(), genre: $("genre").value, ...($("title").value.trim() ? { title: $("title").value.trim() } : {}), ...(revision ? { revision } : {}) };
}
function updateCodeExamples() {
  const input = formInput();
  const fingerprint = JSON.stringify(input);
  if (fingerprint !== exampleFingerprint) { exampleFingerprint = fingerprint; exampleKey = crypto.randomUUID(); }
  try {
    examples = buildCodeExamples(input, exampleKey);
    $("code-example").textContent = examples[codeLanguage];
    $("code-filename").textContent = { javascript: "your-next-idea.mjs", python: "your-next-idea.py", curl: "your-next-request.sh", json: "generation-request.json" }[codeLanguage];
    $("code-note").textContent = "Examples follow your inputs; editing makes no API call. Running one uses credits. Save its input and request key together for retries.";
    $("copy-code").disabled = false;
  } catch (error) {
    examples = null; $("code-example").textContent = error.message;
    $("code-note").textContent = "Complete a valid prompt and genre to see a runnable request.";
    $("copy-code").disabled = true;
  }
}
function fill(input) {
  $("prompt").value = input.prompt;
  $("genre").value = input.genre;
  $("title").value = input.title || "";
  updateCount();
}
async function api(path, { method = "GET", body, key, signal } = {}) {
  let response;
  try {
    response = await fetch(path, {
      method, credentials: "same-origin", signal,
      headers: { "X-Starter-CSRF": config.csrf, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...(key ? { "Idempotency-Key": key } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw Object.assign(new Error("Connection interrupted. Retry the same request to avoid creating a second generation."), { retryable: true });
  }
  let data;
  try { data = await response.json(); } catch { throw Object.assign(new Error("The starter returned an unreadable response."), { retryable: true }); }
  if (!response.ok) throw Object.assign(new Error(data.error?.message || "Request failed."), { status: response.status, retryable: data.error?.retryable || response.status === 429 || response.status >= 500, retryAfterMs: Math.max(0, Number(response.headers.get("retry-after")) || 0) * 1000 });
  return data;
}
function pause(ms, signal) {
  return new Promise(resolve => {
    if (signal.aborted) return resolve();
    const abort = () => { clearTimeout(timer); resolve(); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
function setLink(id, url) {
  const link = $(id);
  link.hidden = !url;
  if (url) link.href = url; else link.removeAttribute("href");
}
function renderHistory() {
  if (!history.length) return;
  $("history").replaceChildren(...history.slice(0, 8).map(item => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.title || "Untitled track";
    button.setAttribute("aria-pressed", String(item.id === current?.generation_id));
    button.disabled = submitting || Boolean(activeId && item.id !== activeId);
    button.addEventListener("click", () => { clearError(); currentInput = item; watch(item.id); });
    return button;
  }));
}
function renderComparison(preferredId) {
  const tracks = [...comparisonTracks.values()];
  comparisonPair = choosePair(tracks, comparisonPair, preferredId);
  for (const [side, other] of [["a", "b"], ["b", "a"]]) {
    const select = $("compare-" + side);
    select.replaceChildren(...tracks.map(track => {
      const option = document.createElement("option"); option.value = track.id;
      option.textContent = `${track.title}${track.source === "starter_demo" ? " · demo" : " · MWA"}`;
      option.disabled = track.id === comparisonPair[other]; return option;
    }));
    select.value = comparisonPair[side] || "";
    const track = comparisonTracks.get(comparisonPair[side]);
    $("compare-" + side + "-details").textContent = track ? `${track.genre.replaceAll("_", " ")} · ${track.source === "starter_demo" ? "15-second starter demo" : "MWA audio"}` : "Choose a second ready track to compare.";
    $("listen-" + side).disabled = !track;
  }
  comparison.setPair(comparisonTracks.get(comparisonPair.a), comparisonTracks.get(comparisonPair.b));
}
function collectComparison(job, { autoPair = true } = {}) {
  if (job.audio.status !== "ready" || !job.audio.url) return;
  const metadata = history.find(item => item.id === job.generation_id) || {};
  const id = `generation:${job.generation_id}`;
  comparisonTracks.set(id, {
    id, generationId: job.generation_id, title: metadata.title || job.title || "Your track",
    genre: metadata.genre || job.genre || "music", audioUrl: job.audio.url, expiresAt: job.audio.expiresAt,
    source: job.demo ? "starter_demo" : "mwa_api", ...(job.parentId ? { parentId: `generation:${job.parentId}` } : {}),
  });
  renderComparison(autoPair ? id : undefined);
  if (autoPair && job.parentId && !comparisonTracks.has(`generation:${job.parentId}`) && !parentsLoading.has(job.parentId)) {
    parentsLoading.add(job.parentId);
    api(`/api/generations/${job.parentId}`).then(parent => {
      collectComparison(parent, { autoPair: false }); renderComparison(id);
    }).catch(() => { /* The user can select another track if the parent is unavailable. */ });
  }
}
async function listenComparison(side) {
  const track = comparisonTracks.get(comparisonPair[side.toLowerCase()]);
  if (!track) return;
  if (track.generationId && track.expiresAt && Date.parse(track.expiresAt) < Date.now() + 60_000) {
    try {
      const fresh = await api(`/api/generations/${track.generationId}`);
      if (fresh.audio.status !== "ready") { $("comparison-note").textContent = "That audio is no longer available. Choose another track or open its saved MWA project."; return; }
      collectComparison(fresh, { autoPair: false });
    } catch (error) { $("comparison-note").textContent = error.message; return; }
  }
  if (await comparison.switchTo(side)) event("comparison_played", { side });
}
function renderShowcase(tracks) {
  $("showcase-empty").hidden = tracks.length > 0;
  $("track-showcase-list").replaceChildren(...tracks.map(track => {
    const card = document.createElement("article"); card.className = "showcase-track";
    const tag = document.createElement("p"); tag.className = "eyebrow"; tag.textContent = `MWA API SAMPLE / ${track.genre.replaceAll("_", " ").toUpperCase()}`;
    const title = document.createElement("h3"); title.textContent = track.title;
    const credit = document.createElement("p"); credit.className = "showcase-credit"; credit.textContent = track.credit;
    const player = document.createElement("audio"); player.controls = true; player.preload = "none"; player.src = track.audioUrl; player.setAttribute("aria-label", `Play ${track.title}`);
    const details = document.createElement("details"); const summary = document.createElement("summary"); summary.textContent = "See the public prompt";
    const prompt = document.createElement("p"); prompt.textContent = track.prompt || "The prompt was not shared for this track."; details.append(summary, prompt);
    const actions = document.createElement("div"); actions.className = "showcase-actions";
    const use = document.createElement("button"); use.type = "button"; use.className = "button button-small button-outline"; use.textContent = "Use this prompt ↗";
    use.disabled = !track.prompt;
    use.addEventListener("click", () => { revision = undefined; $("revision-notice").hidden = true; fill(track); updateButtons(); $("prompt").focus(); event("showcase_prompt_used"); });
    const compare = document.createElement("button"); compare.type = "button"; compare.className = "button button-small button-outline"; compare.textContent = "Compare A/B";
    compare.addEventListener("click", () => { comparisonPair = track.parentId && comparisonTracks.has(track.parentId) ? { a: track.parentId, b: track.id } : { ...comparisonPair, a: track.id }; renderComparison(); $("compare").scrollIntoView(); });
    actions.append(use, compare); card.append(tag, title, credit, player, details, actions); return card;
  }));
}
async function loadShowcase() {
  try {
    const response = await fetch("/api/showcase");
    if (!response.ok) throw new Error("Showcase is temporarily unavailable.");
    const data = await response.json();
    for (const track of [...data.tracks, ...data.comparisonDemos]) comparisonTracks.set(track.id, track);
    renderShowcase(data.tracks); renderComparison();
  } catch (error) {
    $("showcase-description").textContent = error.message;
    $("comparison-note").textContent = "The comparison samples could not load. Ready generations will appear here when available.";
  }
}
function render(job) {
  const changed = current?.generation_id !== job.generation_id;
  if (changed) {
    audio.pause(); audio.removeAttribute("src"); audio.load();
    audio.dataset.generation = "";
    retryExportKey = null;
  }
  current = job;
  const track = history.find(item => item.id === job.generation_id) || currentInput;
  $("track-title").textContent = track?.title || "Your new track";
  $("track-caption").textContent = `${job.demo ? "LOCAL PREVIEW" : "MWA GENERATION"} / ${(track?.genre || "music").replaceAll("_", " ").toUpperCase()}`;
  $("art-number").textContent = String(Math.max(1, history.length - history.findIndex(item => item.id === job.generation_id))).padStart(3, "0");
  const ready = hasPlayableAudio(job);
  const busy = isGenerationBusy(job);
  if (busy) activeId = job.generation_id;
  else if (activeId === job.generation_id) activeId = null;
  $("progress-region").hidden = !busy;
  $("generation-progress").value = job.progress;
  $("progress-label").textContent = `${Math.round(job.progress * 100)}%`;
  $("stage-label").textContent = job.demo ? "Previewing the app workflow" : job.stage.replaceAll("_", " ");
  $("track-description").textContent = job.demo ? "A 15-second synthesized sample to explore the interface. Preview audio does not follow your prompt." : busy ? "MWA is preparing your track. You can leave this tab open while it works." : ready ? "Your track is ready. Listen, download, or explore another version." : "Your generation status is available below.";
  if (ready && (changed || !audio.getAttribute("src"))) {
    audio.src = job.audio.url;
    audio.dataset.generation = job.generation_id;
  } else if (ready && audio.paused && audio.src !== new URL(job.audio.url, location.origin).href) {
    const time = audio.currentTime;
    audio.src = job.audio.url;
    audio.addEventListener("loadedmetadata", () => { if (Number.isFinite(time)) audio.currentTime = Math.min(time, audio.duration || time); }, { once: true });
  }
  audio.hidden = !ready;
  $("play-button").disabled = !ready;
  $("result-actions").hidden = !ready;
  setLink("audio-download", ready ? job.audio.url : null);
  setLink("project-download", job.projectUrl);
  setLink("studio-link", job.studioUrl);
  setLink("project-workspace-link", job.audio.status === "ready" ? `/project?generation=${job.generation_id}` : null);
  $("cancel").hidden = terminal.has(job.status);
  $("refresh-status").hidden = busy || job.demo;
  $("retry-export").hidden = !job.audio.canRetry || busy || job.demo;
  const note = job.error?.message || (job.status === "cancelled" ? "Generation cancelled. You can start a new track." : job.audio.status === "expired" ? "The audio download has expired. The saved project may still be available in MWA." : job.audio.status === "failed" ? "Audio export failed. Your saved project may still be available; retry if offered." : job.audio.status === "unavailable" && terminal.has(job.status) ? "Audio is not currently available. Refresh the status or open the saved project." : job.demo ? "Preview mode · no AI generation · no API credits used" : ready ? "Save your audio while available. Refresh links if a signed download expires." : "Progress reflects the API response. Generation time varies.");
  $("result-note").textContent = [note, ...job.warnings].join(" ");
  updateButtons(); renderHistory(); updateSetup();
  collectComparison(job);
}
async function watch(id) {
  polling?.abort();
  const controller = new AbortController(); polling = controller;
  let delay = config.mode === "demo" ? 500 : 3000;
  const started = Date.now();
  while (!controller.signal.aborted) {
    try {
      const job = await api(`/api/generations/${id}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      render(job);
      if (!isGenerationBusy(job)) {
        announce(job.audio.status === "ready" ? "Your audio is ready to play." : $("result-note").textContent);
        event("generation_finished", { status: job.status, audioReady: job.audio.status === "ready" });
        return;
      }
      delay = config.mode === "demo" ? 500 : 3000;
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!error.retryable) {
        if (error.status === 404 || error.status === 401) activeId = null;
        showError(error.message); updateButtons(); return;
      }
      delay = Math.max(Math.min(delay * 2, 30_000), error.retryAfterMs || 0);
      $("result-note").textContent = "Connection interrupted. Checking again shortly; no new generation is being submitted.";
    }
    if (Date.now() - started > 15 * 60_000) {
      $("result-note").textContent = "This is taking longer than expected. Your job may still be running. Refresh status to keep checking.";
      $("refresh-status").hidden = false;
      return;
    }
    await pause(delay, controller.signal);
  }
}
async function submit(request) {
  if (submitting) return;
  clearError(); submitting = true;
  pendingSave(request); updateButtons();
  event("generation_requested");
  try {
    const job = await api("/api/generations", { method: "POST", body: request.input, key: request.key });
    pendingSave(null);
    currentInput = request.input;
    history = [{ ...request.input, id: job.generation_id }, ...history.filter(item => item.id !== job.generation_id)];
    revision = undefined; $("revision-notice").hidden = true;
    updateCodeExamples();
    render(job);
    announce(config.mode === "demo" ? "Preview started." : "Generation accepted.");
    watch(job.generation_id);
  } catch (error) {
    if (!error.retryable) pendingSave(null);
    showError(error.message, Boolean(pending));
    event("generation_request_failed");
  } finally { submitting = false; updateButtons(); renderHistory(); }
}

form.addEventListener("submit", e => {
  e.preventDefault();
  if (!config || submitting || activeId || pending || !form.reportValidity()) return;
  const input = formInput();
  submit({ input, key: crypto.randomUUID() });
});
$("retry-submit").addEventListener("click", () => { if (pending) submit(pending); });
$("prompt").addEventListener("input", updateCount);
$("genre").addEventListener("change", updateCodeExamples);
$("title").addEventListener("input", updateCodeExamples);
document.querySelectorAll('[name="code-language"]').forEach(radio => radio.addEventListener("change", () => { codeLanguage = radio.value; updateCodeExamples(); }));
document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => fill(presets[button.dataset.preset])));
$("clear-revision").addEventListener("click", () => { revision = undefined; $("revision-notice").hidden = true; updateButtons(); updateCodeExamples(); });
for (const kind of ["variation", "remix"]) $(kind).addEventListener("click", () => {
  if (!current || activeId || pending) return;
  const previous = history.find(item => item.id === current.generation_id);
  if (previous) fill(previous);
  revision = { kind, parent_generation_id: current.generation_id };
  $("revision-text").textContent = `Creating a ${kind} of “${previous?.title || "Untitled track"}”. Adjust the prompt, then generate.`;
  $("revision-notice").hidden = false; updateButtons(); $("prompt").focus();
  updateCodeExamples();
});
$("compare-current").addEventListener("click", () => {
  if (!current || current.audio.status !== "ready") return;
  collectComparison(current);
  const id = `generation:${current.generation_id}`;
  if (!current.parentId) comparisonPair = { ...comparisonPair, a: id };
  renderComparison(current.parentId ? id : undefined);
  $("compare").scrollIntoView();
});
for (const side of ["a", "b"]) {
  $("compare-" + side).addEventListener("change", event => { comparisonPair = { ...comparisonPair, [side]: event.target.value }; renderComparison(); });
  $("listen-" + side).addEventListener("click", () => listenComparison(side.toUpperCase()));
}
document.addEventListener("play", event => {
  if (event.target.tagName === "AUDIO") document.querySelectorAll("audio").forEach(player => { if (player !== event.target) player.pause(); });
}, true);
$("cancel").addEventListener("click", async () => {
  if (!current) return;
  $("cancel").disabled = true;
  try { render(await api(`/api/generations/${current.generation_id}/cancel`, { method: "POST", body: {} })); watch(current.generation_id); }
  catch (error) { showError(error.message); }
  finally { $("cancel").disabled = false; }
});
$("refresh-status").addEventListener("click", () => { if (current) { clearError(); watch(current.generation_id); } });
$("retry-export").addEventListener("click", async () => {
  if (!current) return;
  retryExportKey ||= crypto.randomUUID();
  $("retry-export").disabled = true;
  try { render(await api(`/api/generations/${current.generation_id}/retry-export`, { method: "POST", body: {}, key: retryExportKey })); watch(current.generation_id); }
  catch (error) { showError(error.message); }
  finally { $("retry-export").disabled = false; }
});
$("play-button").addEventListener("click", async () => {
  try { audio.paused ? await audio.play() : audio.pause(); } catch { showError("Audio could not be played. Refresh the links and try again."); }
});
function playState() {
  $("play-button").firstElementChild.textContent = audio.paused ? "▶" : "Ⅱ";
  $("play-button").setAttribute("aria-label", audio.paused ? "Play track" : "Pause track");
}
audio.addEventListener("play", () => { playState(); event("audio_played"); });
audio.addEventListener("pause", playState);
audio.addEventListener("ended", playState);
audio.addEventListener("error", () => { if (audio.getAttribute("src")) { $("result-note").textContent = "Audio could not load. Refresh the links, or open the audio download."; $("refresh-status").hidden = false; } });
$("copy-code").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("code-example").textContent); $("copy-code").textContent = "Copied"; setTimeout(() => { $("copy-code").textContent = "Copy code"; }, 1800); event("code_copied"); }
  catch { $("copy-code").textContent = "Select and copy the code"; }
});
$("copy-setup").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("setup-command").textContent); $("setup-feedback").textContent = "Commands copied. Run them in your local starter folder."; event("setup_commands_copied"); }
  catch { $("setup-feedback").textContent = "Select and copy the two commands above."; }
});
$("share-card").addEventListener("click", () => {
  if (!current || !hasPlayableAudio(current)) return;
  const track = history.find(item => item.id === current.generation_id) || currentInput || {};
  shareTrack = { title: track.title || current.title || "My next idea", genre: track.genre || current.genre, prompt: track.prompt, demo: current.demo };
  $("share-track-title").value = shareTrack.title;
  $("share-include-prompt").checked = false;
  $("share-feedback").textContent = "Nothing is uploaded or posted automatically.";
  updateShareCard(); $("share-dialog").showModal(); event("share_card_opened");
});
$("share-track-title").addEventListener("input", updateShareCard);
$("share-include-prompt").addEventListener("change", updateShareCard);
$("download-share-card").addEventListener("click", async () => {
  const button = $("download-share-card"); button.disabled = true;
  try {
    const blob = await new Promise(resolve => $("share-canvas").toBlob(resolve, "image/png"));
    if (!blob) throw new Error("Image export failed.");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = "mwa-track-card.png";
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $("share-feedback").textContent = "PNG download requested. Share it wherever you choose."; event("share_card_downloaded");
  } catch { $("share-feedback").textContent = "Could not export the image. Copy the caption, or try another browser."; }
  finally { button.disabled = false; }
});
$("copy-share-caption").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText($("share-caption").value); $("share-feedback").textContent = "Caption copied. Nothing was posted."; event("share_caption_copied"); }
  catch { $("share-caption").focus(); $("share-caption").select(); $("share-feedback").textContent = "Copy the selected caption."; }
});
document.querySelectorAll(".api-access").forEach(link => link.addEventListener("click", () => event("api_access_clicked")));
$("github-link").addEventListener("click", () => event("repository_clicked"));
$("audio-download").addEventListener("click", () => event("audio_download_clicked"));
updateCount();
loadShowcase();

try {
  const response = await fetch("/api/config", { credentials: "same-origin" });
  if (!response.ok) throw new Error("Could not connect to the starter. Reload the page to retry.");
  config = await response.json();
  history = config.recent;
  $("mode-badge").textContent = config.mode === "demo" ? "PREVIEW MODE / NO KEY NEEDED" : "LIVE / MWA API";
  $("mode-explanation").textContent = config.mode === "demo" ? "Explore with a 15-second local sample. Connect MWA to generate music from your prompt." : "Generates a 3-minute electronic track at 128 BPM. Uses your MWA API credits.";
  $("setup-details").open = config.mode === "demo";
  updateSetup();
  document.querySelectorAll(".api-access").forEach(link => { link.href = config.apiAccessUrl; });
  $("mwa-link").href = config.appUrl;
  $("showcase-link").href = config.repositoryUrl ? `${config.repositoryUrl}/issues/new?template=showcase.yml` : config.appUrl;
  if (config.repositoryUrl) {
    $("github-link").href = config.repositoryUrl; $("github-link").hidden = false;
    $("source-link").href = config.repositoryUrl;
    $("showcase-link").textContent = "Share what you built ↗";
  }
  if (pending) { fill(pending.input); showError("A previous submission was interrupted. Retry the same request to recover it safely.", true); }
  const handoffId = new URL(location.href).searchParams.get("project");
  if (handoffId && !pending) {
    try {
      const handoff = await api(`/api/project/handoff/${encodeURIComponent(handoffId)}`);
      fill({ prompt: handoff.prompt, genre: $("genre").value, title: "From my project context" });
      $("mode-explanation").textContent = "Reviewed project summary loaded. Choose a genre, review the prompt, then explicitly generate. This creates a new 180-second track at 128 BPM; it does not import or edit your source project.";
    } catch (error) { showError(error.message); }
  }
  const workflowId = new URL(location.href).searchParams.get("workflow");
  if (workflowId && !pending) {
    try {
      const handoff = await api(`/api/workflows/handoff/${encodeURIComponent(workflowId)}`);
      fill(handoff.input);
      revision = handoff.input.revision;
      if (revision) {
        $("revision-text").textContent = "Reviewed workflow variation loaded. Confirm the parent and prompt before generating.";
        $("revision-notice").hidden = false;
      }
      updateCodeExamples();
      $("mode-explanation").textContent = "Workflow preferences loaded; no request was submitted. This is the developer playground. Live runs use API credits; check pricing and balance in your MWA API account before explicitly generating.";
    } catch (error) { showError(error.message); }
  }
  updateButtons(); renderHistory();
  if (history.length && !pending) { currentInput = history[0]; watch(history[0].id); }
} catch (error) { $("mode-badge").textContent = "CONNECTION UNAVAILABLE"; showError(error.message); }
