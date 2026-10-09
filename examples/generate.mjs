import { readFile } from "node:fs/promises";
import { MwaClient } from "../packages/sdk/index.js";
import { createReceipt, requestHash } from "./receipts.mjs";

// Run: node --env-file=.env examples/generate.mjs request.json
// Re-running the same request file recovers the same job after interruption.
const file = process.argv[2];
if (!file) throw new Error("Provide a request JSON path. See examples/README.md.");
const request = JSON.parse(await readFile(file, "utf8"));
const hash = requestHash(request.input);
const receiptFile = `${file}.receipt.json`;
const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });
let id;
try {
  const receipt = JSON.parse(await readFile(receiptFile, "utf8"));
  if (receipt.idempotencyKey !== request.idempotencyKey || receipt.requestHash !== hash) throw new Error("This receipt does not match the exact request. Keep the original file unchanged when recovering.");
  id = receipt.generationId;
} catch (error) { if (error.code !== "ENOENT") throw error; }
if (!id) {
  const job = await mwa.generate(request.input, { idempotencyKey: request.idempotencyKey });
  id = job.generation_id;
  await createReceipt(receiptFile, { generationId: id, idempotencyKey: request.idempotencyKey, requestHash: hash });
}
console.log(`Generation: ${id}`);
const result = await mwa.wait(id, { onProgress: job => console.log(`${job.status}: ${Math.round((job.progress || 0) * 100)}%`) });
console.log(`Final status: ${result.status}; audio: ${result.audio_export?.status || "unavailable"}`);
if (result.error) console.error(`Generation error: ${result.error.code}`);
if (!["completed", "completed_with_errors"].includes(result.status) || result.audio_export?.status !== "ready") process.exitCode = 1;
// Read fresh signed URLs with mwa.get(id) when your application needs a download.
// This example intentionally avoids persisting signed URLs in a receipt.
