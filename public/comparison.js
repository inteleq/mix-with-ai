export function clampSeek(position, duration) {
  if (!Number.isFinite(position) || position < 0) return 0;
  return Number.isFinite(duration) && duration > 0 ? Math.min(position, Math.max(0, duration - 0.05)) : 0;
}

/** Selects an original/variation pair when both are ready; otherwise preserves user choices. */
export function choosePair(tracks, previous = {}, preferredId) {
  const byId = new Map(tracks.map(track => [track.id, track]));
  const preferred = byId.get(preferredId);
  if (preferred?.parentId && byId.has(preferred.parentId)) return { a: preferred.parentId, b: preferred.id };
  const a = byId.has(previous.a) ? previous.a : tracks[0]?.id || "";
  const b = previous.b !== a && byId.has(previous.b) ? previous.b : tracks.find(track => track.id !== a)?.id || "";
  return { a, b };
}

/** A single native audio element keeps A/B playback mutually exclusive. */
export function createComparisonPlayer(audio, { onState = () => {}, onError = () => {} } = {}) {
  let slots = { A: null, B: null };
  let active = "A";
  let pendingSeek = 0;
  function state() { onState({ active, track: slots[active], playing: !audio.paused }); }
  function seek() {
    if (pendingSeek !== null) { audio.currentTime = clampSeek(pendingSeek, audio.duration); pendingSeek = null; }
  }
  audio.addEventListener("loadedmetadata", seek);
  for (const name of ["play", "pause", "ended"]) audio.addEventListener(name, state);
  audio.addEventListener("error", () => onError("This comparison track could not load. Refresh its link or choose another track."));
  async function switchTo(side, { play = true } = {}) {
    const track = slots[side];
    if (!track?.audioUrl) return;
    const position = pendingSeek !== null ? pendingSeek : Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
    active = side;
    if (audio.getAttribute("src") !== track.audioUrl) {
      audio.pause(); pendingSeek = position;
      audio.src = track.audioUrl; audio.load();
    }
    state();
    if (play) {
      try { await audio.play(); return true; } catch { onError("Press the audio player's play button to listen to this track."); return false; }
    }
    return false;
  }
  return {
    setPair(a, b) {
      slots = { A: a || null, B: b || null };
      if (!slots[active]) active = slots.A ? "A" : "B";
      if (slots[active]) switchTo(active, { play: false });
      else { audio.pause(); audio.removeAttribute("src"); audio.load(); }
      state();
    },
    switchTo,
    active: () => active,
  };
}
