import { createHash } from "node:crypto";
import { basename, isAbsolute, normalize } from "node:path";

const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const handle = value => {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("Live identity is unavailable. Refresh the target preview.");
  return value;
};
const label = value => typeof value === "string" && !/mwa_(?:live|test)_|Bearer\s|https?:\/\/|-----BEGIN|^[~\/\\]|^[A-Za-z]:[\\/]/i.test(value)
  ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) || "Untitled" : "Untitled";

export class AudioImportPreconditionError extends Error {}

const boolean = value => {
  if (![true, false, 0, 1].includes(value)) throw new AudioImportPreconditionError("Live returned an unknown target or transport state.");
  return Boolean(value);
};

async function read(object, property, check) { check(); const value = await object.get(property); check(); return value; }

async function songScope(client, check) {
  // This saved-set path is used only on the local server, never uploaded or returned.
  const file = await read(client.song, "file_path", check);
  if (typeof file !== "string" || !isAbsolute(file) || !/\.als$/i.test(file)) throw new AudioImportPreconditionError("Save the intended Live Set before previewing an import. This Live version must expose saved-set identity.");
  const master = await read(client.song, "master_track", check);
  const tempo = await read(client.song, "tempo", check);
  const playing = boolean(await read(client.song, "is_playing", check));
  const recording = boolean(await read(client.song, "record_mode", check));
  const sessionRecording = boolean(await read(client.song, "session_record", check));
  if (playing || recording || sessionRecording) throw new AudioImportPreconditionError("Stop playback and recording before previewing or applying an audio import.");
  if (!Number.isFinite(tempo) || tempo < 40 || tempo > 220) throw new AudioImportPreconditionError("Live tempo is outside this example's range.");
  return { digest: hash([normalize(file), handle(master?.raw?.id), tempo]), setLabel: label(basename(file)), tempo };
}

async function emptyAudioTrack(track, check) {
  if (boolean(await read(track, "is_foldable", check)) || !boolean(await read(track, "has_audio_input", check)) || boolean(await read(track, "has_midi_input", check))) return null;
  if (boolean(await read(track, "is_frozen", check)) || boolean(await read(track, "arm", check))) return null;
  const clips = await read(track, "arrangement_clips", check);
  const devices = await read(track, "devices", check);
  const slots = await read(track, "clip_slots", check);
  if (!Array.isArray(clips) || !Array.isArray(devices) || !Array.isArray(slots) || slots.length > 256) throw new AudioImportPreconditionError("This example cannot establish that the target track is empty.");
  if (clips.length || devices.length) return null;
  for (const slot of slots) if (boolean(await read(slot, "has_clip", check))) return null;
  const trackId = handle(track.raw?.id);
  const trackLabel = label(await read(track, "name", check));
  const muted = boolean(await read(track, "mute", check));
  const solo = boolean(await read(track, "solo", check));
  return { trackId, trackLabel, fingerprint: hash([trackId, trackLabel, Boolean(muted), Boolean(solo), slots.map(slot => handle(slot.raw?.id))]) };
}

export async function inspectAudioTargets(client, check = () => {}) {
  const scope = await songScope(client, check);
  const tracks = await read(client.song, "tracks", check);
  if (!Array.isArray(tracks) || tracks.length > 128) throw new AudioImportPreconditionError("This example supports at most 128 ordinary tracks.");
  const targets = [];
  for (const track of tracks) {
    const target = await emptyAudioTrack(track, check);
    if (target) targets.push(target);
  }
  if ((await songScope(client, check)).digest !== scope.digest) throw new AudioImportPreconditionError("The Live Set changed during inspection. Preview again while it is idle.");
  return { scope, targets };
}

export async function applyAudioToEmptyTrack(client, { scope, target, positionBeats, filePath }, check = () => {}) {
  if (!Number.isFinite(positionBeats) || positionBeats < 0 || positionBeats > 1000000 || !isAbsolute(filePath)) throw new AudioImportPreconditionError("Invalid prepared audio import.");
  if ((await songScope(client, check)).digest !== scope.digest) throw new AudioImportPreconditionError("The saved Set or tempo changed. Prepare a new preview.");
  const tracks = await read(client.song, "tracks", check);
  if (!Array.isArray(tracks) || tracks.length > 128) throw new AudioImportPreconditionError("Live target enumeration is unavailable or exceeds this example's limit.");
  const matches = tracks.filter(track => track.raw?.id === target.trackId);
  if (matches.length !== 1) throw new AudioImportPreconditionError("The exact target track no longer exists.");
  const track = matches[0];
  const current = await emptyAudioTrack(track, check);
  if (!current || current.fingerprint !== target.fingerprint) throw new AudioImportPreconditionError("The target changed or is no longer an empty audio track. Prepare a new preview.");
  // Last identity check before the one allowed mutation. No index fallback, track creation or deletion.
  if ((await songScope(client, check)).digest !== scope.digest) throw new AudioImportPreconditionError("The Live Set changed before dispatch.");
  check();
  let acknowledged = true;
  try { await track.createAudioClip(filePath, positionBeats); } catch { acknowledged = false; }
  // An error/timeout may still have committed. Never replay; exact readback is the only success proof.
  try {
    if ((await songScope(client, check)).digest !== scope.digest) throw new Error("Set changed after dispatch");
    const clips = await read(track, "arrangement_clips", check);
    if (!Array.isArray(clips) || clips.length !== 1) throw new Error("Unexpected readback");
    const clip = clips[0];
    const audio = await read(clip, "is_audio_clip", check);
    const path = await read(clip, "file_path", check);
    const start = await read(clip, "start_time", check);
    const end = await read(clip, "end_time", check);
    if (!audio || normalize(path) !== normalize(filePath) || !Number.isFinite(start) || Math.abs(start - positionBeats) > 0.000001 || !Number.isFinite(end) || end <= start) throw new Error("Audio placement not verified");
    return { status: "applied", acknowledged, positionBeats: start, lengthBeats: end - start };
  } catch {
    return { status: "needs_review", acknowledged, message: "Live may have imported the audio. Inspect the chosen track before doing anything else. This operation will not be retried automatically." };
  }
}
