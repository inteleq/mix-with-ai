export function createAbletonImportUi({ config, api, runAction, announce }) {
  const $ = id => document.getElementById(id);
  let generationId = null;
  let plan = null;
  let busy = false;
  let pendingId;
  try { pendingId = sessionStorage.getItem("mwa-ableton-audio-operation"); } catch { pendingId = null; }
  if (pendingId && !/^[a-f0-9-]{36}$/i.test(pendingId)) pendingId = null;
  const message = text => { $("ableton-import-status").textContent = text; announce(text); };
  const remember = id => {
    pendingId = id;
    try { id ? sessionStorage.setItem("mwa-ableton-audio-operation", id) : sessionStorage.removeItem("mwa-ableton-audio-operation"); } catch { /* In-memory operation identity remains available. */ }
  };
  function update() {
    const enabled = config.abletonImportAvailable && Boolean(generationId);
    $("inspect-import-targets").disabled = busy || !enabled || Boolean(pendingId);
    $("prepare-audio-import").disabled = busy || !enabled || !$("import-track").value || Boolean(pendingId);
    $("apply-audio-import").disabled = busy || !enabled || Boolean(pendingId) || !plan || plan.status !== "prepared" || plan.generation_id !== generationId || !$("confirm-audio-import").checked;
    $("refresh-audio-import").disabled = busy || !config.abletonImportAvailable || !pendingId && !plan;
    $("clear-import-notice").hidden = !pendingId || plan?.status === "applying";
    for (const id of ["import-track", "import-position", "confirm-audio-import"]) $(id).disabled = busy || !enabled;
  }
  function show(result) {
    plan = result;
    $("audio-import-preview").hidden = false;
    $("audio-import-details").textContent = `${result.status.toUpperCase()}\nGeneration: ${result.generation_id}\nSet: ${result.target.set}\nEmpty track: ${result.target.track}\nPosition: beat ${result.target.position_beats} (zero-based)\nCurrent Set tempo: ${result.target.tempo} BPM · unchanged\nAudio: ${result.audio.format.toUpperCase()}, ${result.audio.byte_size} bytes\nSHA-256: ${result.audio.sha256}\nPreview expires: ${result.expires_at}`;
    message(result.message || "Review the exact saved Set, empty track and beat position, then explicitly confirm the audio import. Nothing has been placed in Live.");
    if (["prepared", "applied", "rejected", "expired"].includes(result.status)) remember(null);
    update();
  }
  function invalidate() {
    plan = null; $("audio-import-preview").hidden = true; $("confirm-audio-import").checked = false; update();
  }
  $("inspect-import-targets").addEventListener("click", () => runAction(async () => {
    invalidate(); message("Reading saved Set identity and eligible empty audio tracks. No Live changes.");
    const result = await api("/api/ableton/targets", {});
    const options = result.targets.map(target => { const node = document.createElement("option"); node.value = target.track_id; node.textContent = target.label; return node; });
    $("import-track").replaceChildren(...options);
    $("import-set").textContent = `${result.setLabel} · ${result.tempo} BPM`;
    message(options.length ? "Choose an empty track and placement, then prepare the audio preview." : "Create a dedicated empty audio track without devices or Session clips in Live, then refresh targets.");
    update();
  }));
  for (const id of ["import-track", "import-position"]) $(id).addEventListener("change", invalidate);
  $("confirm-audio-import").addEventListener("change", update);
  $("prepare-audio-import").addEventListener("click", () => runAction(async () => {
    if (!$("import-position").reportValidity()) return;
    message("Refreshing owned audio, caching it locally and checking the target. No Live import yet.");
    show(await api("/api/ableton/imports", { generation_id: generationId, track_id: $("import-track").value, position_beats: Number($("import-position").value) }));
    $("confirm-audio-import").checked = false; update();
  }));
  $("apply-audio-import").addEventListener("click", () => runAction(async () => {
    if (!plan || plan.status !== "prepared" || !$("confirm-audio-import").checked) return;
    const id = plan.id; remember(id);
    message("Applying the reviewed audio import once. If the connection fails, check this operation's status and inspect Live before another attempt.");
    show(await api(`/api/ableton/imports/${id}/apply`, { confirm: true }));
  }));
  $("refresh-audio-import").addEventListener("click", () => runAction(async () => {
    const id = pendingId || plan?.id;
    if (id) show(await api(`/api/ableton/imports/${id}`));
  }));
  $("clear-import-notice").addEventListener("click", () => {
    remember(null); invalidate();
    message("Pending notice cleared after your inspection. This does not remove audio or replay the previous operation. Refresh targets before a new preview.");
    $("import-track").replaceChildren(); update();
  });
  $("import-enable-note").textContent = config.abletonImportAvailable
    ? "Reviewed import enabled. Load a ready live MWA generation above. Close competing connectors and keep Live stopped."
    : "Import is off. Configure live MWA mode, install the matching optional AbletonJS script, then explicitly run npm run ableton:import.";
  if (pendingId) message("A previous import has an unresolved local notice. Check its status and inspect Live before preparing another import.");
  update();
  return {
    setBusy(value) { busy = value; update(); },
    setGeneration(job) { generationId = job && !job.demo && job.audio.status === "ready" ? job.generation_id : null; $("import-track").replaceChildren(); invalidate(); },
  };
}
