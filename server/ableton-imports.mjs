import { randomUUID } from "node:crypto";
import { createAudioImportStore } from "./audio-import-store.mjs";
import { AudioImportPreconditionError } from "../integrations/ableton/import-audio.mjs";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const error = (status, message) => Object.assign(new Error(message), { status });
function fields(body, allowed) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw error(400, "Unexpected import fields. Supply only the documented identifiers and position.");
}

export function createAbletonImportRoutes({ music, importer, store = createAudioImportStore(), now = Date.now, runExclusive, readJson, json }) {
  return async (path, req, res, session) => {
    if (!importer) throw error(409, "Audio import is disabled. Configure live MWA mode and explicitly start npm run ableton:import. The normal Ableton command remains read-only.");
    session.imports ??= new Map();
    if (path === "/api/ableton/targets" && req.method === "POST") {
      fields(await readJson(req), []);
      let inspection;
      try { inspection = await runExclusive(() => importer.inspect()); }
      catch (failure) { if (failure.status) throw failure; throw error(409, "Could not establish a saved, stopped Live Set with an empty audio track. Save the Set, stop playback/recording, and create a dedicated empty audio track without devices or Session clips."); }
      session.targetPreview = { inspection, createdAt: now() };
      json(res, 200, { setLabel: inspection.scope.setLabel, tempo: inspection.scope.tempo, targets: inspection.targets.map(target => ({ track_id: target.trackId, label: target.trackLabel })) });
      return;
    }
    if (path === "/api/ableton/imports" && req.method === "POST") {
      const body = await readJson(req); fields(body, ["generation_id", "track_id", "position_beats"]);
      if (!uuid.test(body.generation_id ?? "") || typeof body.track_id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(body.track_id) || typeof body.position_beats !== "number" || !Number.isFinite(body.position_beats) || body.position_beats < 0 || body.position_beats > 1000000) throw error(400, "Supply a generation UUID, inspected track ID and zero-based position in beats.");
      if (!session.jobs.has(body.generation_id)) throw error(404, "Generation not found in this local session.");
      if (!session.targetPreview || now() - session.targetPreview.createdAt > 120000) throw error(409, "Refresh the Live target list before preparing an import.");
      if (session.imports.size >= 10) throw error(429, "This local session has reached its ten-preview limit. Inspect existing receipts before starting another session.");
      const preview = session.targetPreview.inspection;
      const selected = preview.targets.find(target => target.trackId === body.track_id);
      if (!selected) throw error(409, "Choose an empty audio track from the inspected target list.");
      let record;
      await runExclusive(async () => {
        const inspection = await importer.inspect();
        const target = inspection.targets.find(item => item.trackId === selected.trackId);
        if (inspection.scope.digest !== preview.scope.digest || !target || target.fingerprint !== selected.fingerprint) throw error(409, "The Live Set or target changed. Refresh targets and review again.");
        const generation = await music.get(body.generation_id);
        if (generation.generation_id?.toLowerCase() !== body.generation_id.toLowerCase() || generation.audio_export?.status !== "ready") throw error(409, "This generation does not have verified ready audio.");
        const asset = await store.stage(generation);
        const plan = { id: randomUUID(), generation_id: body.generation_id, status: "prepared", expires_at: new Date(now() + 600000).toISOString(),
          target: { set: inspection.scope.setLabel, track: target.trackLabel, position_beats: body.position_beats, tempo: inspection.scope.tempo },
          audio: { format: asset.format, byte_size: asset.byteSize, sha256: asset.checksum } };
        await store.prepare(plan);
        record = { plan, asset, scope: inspection.scope, target, promise: null };
        session.imports.set(plan.id, record);
      });
      json(res, 200, record.plan); return;
    }
    const match = path.match(/^\/api\/ableton\/imports\/([a-f0-9-]+)(?:\/(apply))?$/i);
    if (!match || !uuid.test(match[1])) throw error(404, "Import route not found.");
    const record = session.imports.get(match[1]);
    if (!record) throw error(404, "Import preview not found in this local session. After a restart, inspect Live and the private local receipts instead of recreating an ambiguous import.");
    if (req.method === "GET" && !match[2]) { json(res, 200, record.plan); return; }
    if (req.method !== "POST" || match[2] !== "apply") throw error(405, "Method not allowed.");
    const body = await readJson(req); fields(body, ["confirm"]);
    if (body.confirm !== true) throw error(400, "Explicitly confirm the reviewed Set, empty track, audio and placement.");
    if (record.promise) { await record.promise; json(res, 200, record.plan); return; }
    if (record.plan.status !== "prepared") { json(res, 200, record.plan); return; }
    if (Date.parse(record.plan.expires_at) <= now()) {
      record.plan.status = "expired"; json(res, 200, record.plan); return;
    }
    record.promise = runExclusive(async () => {
      let enteredImporter = false;
      record.plan.status = "applying";
      try {
        await store.verify(record.asset);
        await store.begin(record.plan.id);
        enteredImporter = true;
        const result = await importer.apply({ scope: record.scope, target: record.target, positionBeats: record.plan.target.position_beats, filePath: record.asset.filePath });
        if (result.status === "applied" && Number.isFinite(result.positionBeats) && Number.isFinite(result.lengthBeats) && result.lengthBeats > 0) {
          record.plan.status = "applied";
          record.plan.result = { position_beats: result.positionBeats, length_beats: result.lengthBeats, acknowledged: result.acknowledged === true };
          record.plan.message = "Audio placement verified by Live readback. Use Collect All and Save in Live to retain the referenced audio in your project.";
        } else {
          record.plan.status = "needs_review";
          record.plan.message = "Live may have imported the audio. Inspect the chosen track. This operation will not be replayed automatically.";
        }
      } catch (failure) {
        const rejected = failure instanceof AudioImportPreconditionError || !enteredImporter && failure.code !== "EEXIST";
        record.plan.status = rejected ? "rejected" : "needs_review";
        record.plan.message = rejected ? "The target changed or cached audio could not be verified. No import was dispatched. Prepare a new preview." : "The import outcome is uncertain. Inspect Live and the local receipt before any new attempt. This operation will not be replayed.";
      }
      try { await store.finish(record.plan.id, { status: record.plan.status, result: record.plan.result, message: record.plan.message }); }
      catch { record.plan.status = "needs_review"; record.plan.message = "The final local receipt could not be saved. Inspect Live; this operation will not be replayed."; }
    }).finally(() => { record.promise = null; });
    await record.promise;
    json(res, 200, record.plan);
  };
}
