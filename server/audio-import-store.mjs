import { mkdir, lstat, open, rename } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const LIMIT = 64 * 1024 * 1024;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const identifier = value => { if (!uuid.test(value ?? "")) throw new Error("Invalid import identifier."); return value; };

async function directory(path) {
  try { const info = await lstat(path); if (!info.isDirectory() || info.isSymbolicLink() || process.platform !== "win32" && (info.mode & 0o077)) throw new Error("Audio import storage must use regular private directories."); }
  catch (error) { if (error.code !== "ENOENT") throw error; await mkdir(path, { mode: 0o700 }); }
}
async function exclusive(path, bytes) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function regularBytes(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > LIMIT) throw new Error("Invalid cached import file.");
    return await file.readFile();
  } finally { await file.close(); }
}

export function createAudioImportStore({ directory: location = fileURLToPath(new URL("../.mwa-examples/", import.meta.url)), downloadFetch = fetch } = {}) {
  const base = resolve(location);
  const root = join(base, "ableton-imports");
  const media = join(root, "media");
  const receipts = join(root, "receipts");
  async function folders() { for (const path of [base, root, media, receipts]) await directory(path); }
  return {
    async stage(generation) {
      identifier(generation?.generation_id);
      if (generation.audio_export?.status !== "ready") throw new Error("This generation has no ready audio.");
      const url = new URL(generation.audio_export.download_url);
      if (url.protocol !== "https:" || url.username || url.password || url.hash || /^(?:localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname)) throw new Error("Expected a trusted signed HTTPS audio URL.");
      // No MWA key, cookies, user URLs or redirects in this storage request.
      const response = await downloadFetch(url, { redirect: "error", credentials: "omit", signal: AbortSignal.timeout(60000) });
      if (!response.ok || !response.body) throw new Error("Audio download failed.");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (!Number.isFinite(declared) || declared < 0 || declared > LIMIT) { await response.body.cancel(); throw new Error("Audio exceeds the 64 MiB import limit."); }
      const reader = response.body.getReader(); const chunks = []; let size = 0;
      try {
        while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
          if (size > LIMIT) { await reader.cancel(); throw new Error("Audio exceeds the 64 MiB import limit."); } chunks.push(value); }
      } finally { reader.releaseLock(); }
      if (!size || (declared && declared !== size)) throw new Error("Incomplete audio download.");
      const bytes = Buffer.concat(chunks);
      const format = bytes.length >= 44 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WAVE" ? "wav"
        : bytes.length >= 32 && (bytes.toString("ascii", 0, 3) === "ID3" || bytes[0] === 255 && (bytes[1] & 224) === 224) ? "mp3" : null;
      if (!format) throw new Error("This example imports recognized WAV or MP3 audio only.");
      const checksum = digest(bytes);
      const artifact = generation.artifact_manifest?.artifacts?.find(item => item.status === "ready" && item.download_url === url.href);
      if (artifact?.byte_size !== undefined && artifact.byte_size !== size || artifact?.checksum_sha256 && artifact.checksum_sha256 !== checksum) throw new Error("Audio artifact integrity check failed.");
      await folders();
      const filePath = join(media, `${generation.generation_id.toLowerCase()}-${checksum}.${format}`);
      try { await exclusive(filePath, bytes); }
      catch (error) { if (error.code !== "EEXIST" || digest(await regularBytes(filePath)) !== checksum) throw error; }
      return { filePath, checksum, byteSize: size, format };
    },
    async verify(asset) {
      if (resolve(asset.filePath) !== join(media, asset.filePath.split(/[\\/]/).at(-1))) throw new Error("Audio cache path mismatch.");
      const bytes = await regularBytes(asset.filePath);
      if (bytes.length !== asset.byteSize || digest(bytes) !== asset.checksum) throw new Error("Cached audio changed. No Live import was dispatched.");
    },
    async prepare(plan) {
      await folders();
      const path = join(receipts, `${identifier(plan.id)}.receipt.json`);
      await exclusive(path, `${JSON.stringify(plan, null, 2)}\n`);
    },
    async begin(id) { await folders(); await exclusive(join(receipts, `${identifier(id)}.started`), "Import claimed; do not replay after an ambiguous result.\n"); },
    async finish(id, result) {
      await folders();
      const path = join(receipts, `${identifier(id)}.receipt.json`);
      const prior = JSON.parse((await regularBytes(path)).toString("utf8"));
      const temporary = join(receipts, `${identifier(id)}-${randomUUID()}.tmp`);
      await exclusive(temporary, `${JSON.stringify({ ...prior, ...result }, null, 2)}\n`);
      await rename(temporary, path);
    },
  };
}
