import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { MwaClient } from "../packages/sdk/index.js";

const [generationId, output] = process.argv.slice(2);
if (!generationId || !output || process.argv.length !== 4) throw new Error("Usage: node --env-file=.env examples/download-audio.mjs <owned generation UUID> <output file>");
const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });
const generation = await mwa.get(generationId);
if (generation.audio_export?.status !== "ready" || !generation.audio_export.download_url) throw new Error("Audio is unavailable. Read this generation's status before downloading.");
const url = new URL(generation.audio_export.download_url);
if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Expected a signed HTTPS audio URL.");
// No MWA credentials on storage, and no redirect forwarding.
const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(120_000) });
if (!response.ok || !response.body) throw new Error("Audio download failed. Refresh this generation for an available delivery link.");
const limit = 64 * 1024 * 1024, declared = Number(response.headers.get("content-length") ?? 0);
if (declared > limit) { await response.body.cancel(); throw new Error("This example limits downloads to 64 MiB."); }
const reader = response.body.getReader(), chunks = [];
let size = 0;
try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw new Error("This example limits downloads to 64 MiB."); }
    chunks.push(value);
  }
} finally { reader.releaseLock(); }
if (!size || (declared > 0 && declared !== size)) throw new Error("Incomplete audio download.");
const audio = Buffer.concat(chunks);
const artifact = generation.artifact_manifest?.artifacts?.find(item => item.status === "ready" && item.download_url === url.href);
if (artifact?.byte_size !== undefined && artifact.byte_size !== size) throw new Error("Artifact size mismatch.");
if (artifact?.checksum_sha256 && createHash("sha256").update(audio).digest("hex") !== artifact.checksum_sha256) throw new Error("Artifact checksum mismatch.");
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, audio, { flag: "wx", mode: 0o600 });
console.log(`Saved audio to ${output}. Existing files are never overwritten.`);
