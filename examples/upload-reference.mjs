import { parseArgs } from "node:util";
import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { MwaClient, createRequest } from "../packages/sdk/index.js";
import { readJson, createReceipt, updateReceipt } from "./receipts.mjs";

const mimeTypes = { ".wav": "audio/wav", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".flac": "audio/flac", ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".aac": "audio/aac", ".ogg": "audio/ogg", ".opus": "audio/opus" };
const { values, positionals } = parseArgs({ allowPositionals: true, options: { output: { type: "string" }, "owns-audio": { type: "boolean" } } });
const [command, ...args] = positionals;
const usage = "Use prepare <parent UUID> <audio file> <duration seconds> --owns-audio [--output file], or run <saved upload JSON>.";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function audioBytes(path) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 256 || info.size > 50 * 1024 * 1024) throw new Error("Use an owned audio file of 256 bytes to 50 MiB.");
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw new Error("The audio file changed while being read.");
  return bytes;
}

if (command === "prepare" && args.length === 3) {
  const [generationId, path, duration] = args;
  if (!values["owns-audio"]) throw new Error("Confirm that you own the audio with --owns-audio.");
  createRequest({ prompt: "Reference preparation", genre: "deep_house", revision: { parent_generation_id: generationId, kind: "variation" } });
  const durationSeconds = Number(duration), contentType = mimeTypes[extname(path).toLowerCase()];
  if (!contentType || !Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > 3600) throw new Error("Use a supported audio format and duration greater than zero, up to one hour.");
  const bytes = await audioBytes(path);
  const file = values.output ?? ".mwa-examples/reference-upload.json";
  await createReceipt(file, { idempotencyKey: randomUUID(), audioPath: resolve(path), metadata: {
    generation_id: generationId, filename: basename(path), byte_size: bytes.length, duration_seconds: durationSeconds,
    content_type: contentType, content_sha256: digest(bytes), user_owns_audio: true,
  } });
  console.log(`Upload plan saved to ${file}. No API request was made. Keep the plan and source audio private.`);
} else if (command === "run" && args.length === 1 && !Object.keys(values).length) {
  const file = args[0], plan = await readJson(file), bytes = await audioBytes(plan.audioPath);
  if (bytes.length !== plan.metadata.byte_size || digest(bytes) !== plan.metadata.content_sha256) throw new Error("The source changed. Recover with the original file and saved upload plan.");
  const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });
  const uploaded = await mwa.uploadReference(plan.metadata.generation_id, new Blob([bytes], { type: plan.metadata.content_type }), {
    filename: plan.metadata.filename, durationSeconds: plan.metadata.duration_seconds,
    userOwnsAudio: plan.metadata.user_owns_audio, idempotencyKey: plan.idempotencyKey,
  });
  const receiptFile = `${file}.receipt.json`;
  const save = reference => updateReceipt(receiptFile, {
    reference_id: reference.reference_id, generation_id: reference.generation_id,
    content_sha256: reference.content_sha256, status: reference.status, guidance_available: reference.guidance_available,
  });
  await save(uploaded);
  const reference = await mwa.waitForReference(uploaded.reference_id, { onProgress: value => console.log(`Reference: ${value.status}`) });
  await save(reference);
  if (reference.status !== "ready" || !reference.guidance_available) throw new Error("Reference guidance is unavailable. Inspect this receipt; do not create a new generation to recover it.");
  console.log(`Ready reference receipt saved to ${receiptFile}. No music generation was requested.`);
} else throw new Error(usage);
