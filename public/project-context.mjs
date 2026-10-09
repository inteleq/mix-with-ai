// Original public projection. This is a draft format, not a Live Set or MWA database schema.
export const PROJECT_SCHEMA = "mwa_public_project_draft_v1";
export const PROJECT_LIMITS = Object.freeze({ tracks: 128, clips: 1024, devicesPerTrack: 32, bytes: 262144 });
const kinds = new Set(["audio", "midi", "group", "return", "master"]);
const fail = message => { throw new Error(message); };
function number(value, min, max, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max) fail(`${label} is outside the supported range.`);
  return value;
}
function text(value, fallback, max = 120) {
  if (typeof value !== "string") return fallback;
  const clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  // Labels are display data. Do not carry recognizable credentials, URLs or absolute paths.
  if (!clean || /mwa_(?:live|test)_|Bearer\s|https?:\/\/|^[~\/\\]|^[A-Za-z]:[\\/]|-----BEGIN/i.test(clean)) return fallback;
  return clean;
}

export function cleanProject(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) || input.schema_version !== PROJECT_SCHEMA) fail("Use a public project draft JSON file. Raw .als files and private MWA project schemas are not supported here.");
  if (!["demo", "ableton", "mwa"].includes(input.source)) fail("Unknown project source.");
  if (!Array.isArray(input.tracks) || !input.tracks.length || input.tracks.length > PROJECT_LIMITS.tracks) fail("A draft needs 1–128 tracks.");
  const ids = new Set();
  let clipCount = 0;
  const tracks = input.tracks.map((track, index) => {
    if (!track || typeof track !== "object" || !kinds.has(track.kind)) fail("Unsupported track kind.");
    for (const field of ["selected", "muted"]) if (track[field] !== undefined && typeof track[field] !== "boolean") fail(`${field} must be a boolean.`);
    const id = typeof track.id === "string" && /^[a-zA-Z0-9_-]{1,64}$/.test(track.id) ? track.id : `track-${index + 1}`;
    if (ids.has(id)) fail("Track identifiers must be unique within the draft.");
    ids.add(id);
    const clips = track.clips ?? [];
    if (!Array.isArray(clips) || (clipCount += clips.length) > PROJECT_LIMITS.clips) fail("The draft exceeds 1024 clips.");
    if (track.devices !== undefined && (!Array.isArray(track.devices) || track.devices.length > PROJECT_LIMITS.devicesPerTrack)) fail("A track exceeds 32 device labels.");
    return {
      id, name: text(track.name, `Track ${index + 1}`), kind: track.kind,
      selected: track.selected !== false, muted: track.muted === true,
      ...(track.volume_normalized === undefined ? {} : { volume_normalized: number(track.volume_normalized, 0, 1, "Volume") }),
      ...(track.pan === undefined ? {} : { pan: number(track.pan, -1, 1, "Pan") }),
      devices: (track.devices ?? []).map((value, i) => text(value, `Device ${i + 1}`, 80)),
      clips: clips.map((clip, i) => ({
        name: text(clip?.name, `Clip ${i + 1}`),
        start_beats: number(clip?.start_beats, 0, 1000000, "Clip start"),
        length_beats: number(clip?.length_beats, 0.001, 1000000, "Clip length"),
      })),
    };
  });
  return { schema_version: PROJECT_SCHEMA, source: input.source, title: text(input.title, "Untitled draft"), tempo: number(input.tempo, 40, 220, "Tempo"), tracks };
}

export function selectedContext(input, { includeNames = false } = {}) {
  const draft = cleanProject(input);
  const tracks = draft.tracks.filter(track => track.selected);
  if (!tracks.length) fail("Select at least one track to prepare context.");
  return { schema_version: PROJECT_SCHEMA, source: draft.source, tempo: draft.tempo,
    tracks: tracks.map((track, index) => ({
      id: `track-${index + 1}`, kind: track.kind, muted: track.muted,
      ...(includeNames ? { name: track.name, devices: track.devices } : {}),
      ...(track.volume_normalized === undefined ? {} : { volume_normalized: track.volume_normalized }),
      ...(track.pan === undefined ? {} : { pan: track.pan }),
      clips: track.clips.map(clip => ({ start_beats: clip.start_beats, length_beats: clip.length_beats, ...(includeNames ? { name: clip.name } : {}) })),
    })),
  };
}

export function buildContextPrompt(input, options = {}) {
  const context = selectedContext(input, options);
  const intent = text(options.intent, "Create a new electronic track inspired by this arrangement.", 500);
  const counts = context.tracks.reduce((result, track) => { result[track.kind] = (result[track.kind] ?? 0) + 1; return result; }, {});
  const end = Math.max(0, ...context.tracks.flatMap(track => track.clips.map(clip => clip.start_beats + clip.length_beats)));
  const lines = [intent, `Source arrangement: ${context.tempo} BPM; ${context.tracks.length} selected tracks (${Object.entries(counts).map(([kind, count]) => `${count} ${kind}`).join(", ")}); ${context.tracks.reduce((sum, track) => sum + track.clips.length, 0)} arrangement clips; last clip ends at beat ${Math.round(end * 100) / 100}.`];
  if (options.includeNames) lines.push(`Selected labels: ${context.tracks.slice(0, 8).map(track => track.name).join("; ")}.`);
  lines.push("Generate a new 180-second track at 128 BPM. This is descriptive context, not project import, audio analysis or an instruction to edit the source session.");
  const prompt = lines.join("\n");
  if (new TextEncoder().encode(prompt).byteLength > 1500) fail("Shorten your instruction or omit track labels to fit the public generation profile.");
  return { context, prompt };
}

export function demoProject() {
  return cleanProject({ schema_version: PROJECT_SCHEMA, source: "demo", title: "After hours · original demo draft", tempo: 128, tracks: [
    { id: "drums", name: "Drums", kind: "audio", volume_normalized: 0.72, pan: 0, devices: ["Compressor"], clips: [{ name: "Groove", start_beats: 0, length_beats: 32 }, { name: "Return", start_beats: 48, length_beats: 32 }] },
    { id: "bass", name: "Bass", kind: "midi", volume_normalized: 0.65, pan: 0, devices: ["Instrument"], clips: [{ name: "Bassline", start_beats: 8, length_beats: 24 }, { name: "Variation", start_beats: 48, length_beats: 32 }] },
    { id: "chords", name: "Chords", kind: "midi", volume_normalized: 0.56, pan: -0.15, devices: ["Instrument", "Reverb"], clips: [{ name: "Warmth", start_beats: 16, length_beats: 48 }] },
  ] });
}
