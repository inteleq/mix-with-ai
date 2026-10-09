import { cleanProject, PROJECT_SCHEMA, PROJECT_LIMITS } from "../../public/project-context.mjs";

// Only get() calls: no private mappings, Live writes, subscriptions or raw protocol dispatch.
export async function captureProject(client, { timeoutMs = 20000 } = {}) {
  let expired = false;
  let timer;
  const warnings = new Set();
  const check = () => { if (expired) throw new Error("Capture timed out. Retry on a smaller, idle Live Set."); };
  const get = async (object, field) => { check(); const value = await object.get(field); check(); return value; };
  const optional = async (object, field, warning) => {
    try { return await get(object, field); } catch { check(); warnings.add(warning); return undefined; }
  };
  let count = 0;
  const task = async () => {
    await client.start(5000);
    check();
    const tempo = await get(client.song, "tempo");
    const ordinary = await get(client.song, "tracks");
    const returns = await get(client.song, "return_tracks");
    const master = await get(client.song, "master_track");
    if (!Array.isArray(ordinary) || !Array.isArray(returns) || !master || ordinary.length + returns.length + 1 > PROJECT_LIMITS.tracks) throw new Error("This example supports at most 128 tracks including returns and master.");
    const collections = [...ordinary.map(track => [track, "ordinary"]), ...returns.map(track => [track, "return"]), [master, "master"]];
    const tracks = [];
    for (const [track, collection] of collections) {
      check();
      const name = await get(track, "name");
      const kind = collection === "ordinary" ? await get(track, "is_foldable") ? "group" : await get(track, "has_midi_input") ? "midi" : "audio" : collection;
      const muted = collection === "master" ? false : Boolean(await optional(track, "mute", "mixer_read_incomplete"));
      const mixer = await optional(track, "mixer_device", "mixer_read_incomplete");
      const volume = mixer ? await optional(mixer, "volume", "mixer_read_incomplete") : undefined;
      const pan = mixer ? await optional(mixer, "panning", "mixer_read_incomplete") : undefined;
      const volumeValue = volume ? await optional(volume, "value", "mixer_read_incomplete") : undefined;
      const panValue = pan ? await optional(pan, "value", "mixer_read_incomplete") : undefined;
      const rawDevices = await optional(track, "devices", "device_labels_incomplete");
      if (rawDevices?.length > PROJECT_LIMITS.devicesPerTrack) throw new Error("This example supports at most 32 top-level device labels per track.");
      const devices = [];
      for (const device of rawDevices ?? []) devices.push(await get(device, "name"));
      const rawClips = collection === "ordinary" ? await optional(track, "arrangement_clips", "arrangement_clips_unavailable") : [];
      if ((count += rawClips?.length ?? 0) > PROJECT_LIMITS.clips) throw new Error("This example supports at most 1024 arrangement clips.");
      const clips = [];
      for (const clip of rawClips ?? []) {
        const start = await get(clip, "start_time");
        const end = await get(clip, "end_time");
        clips.push({ name: await get(clip, "name"), start_beats: start, length_beats: end - start });
      }
      tracks.push({ id: `track-${tracks.length + 1}`, name, kind, muted, devices, clips,
        ...(volumeValue === undefined ? {} : { volume_normalized: volumeValue }), ...(panValue === undefined ? {} : { pan: panValue }) });
    }
    if (await get(client.song, "tempo") !== tempo) throw new Error("Tempo changed during capture. Retry while the set is idle.");
    // This is a bounded observational draft, never an authoritative synchronization baseline.
    return { project: cleanProject({ schema_version: PROJECT_SCHEMA, source: "ableton", title: "Ableton session draft", tempo, tracks }), warnings: [...warnings], atomic: false };
  };
  try {
    return await Promise.race([task(), new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error("Capture timed out. Retry on a smaller, idle Live Set.")); }, timeoutMs);
    })]);
  } finally {
    expired = true;
    clearTimeout(timer);
    await client.close();
  }
}
