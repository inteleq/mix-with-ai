import { writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequest } from "../packages/sdk/index.js";

// This prepares a request file without making an API call.
// Run: node examples/revise.mjs <parent-generation-id> variation request.json
const [parentId, kind, file] = process.argv.slice(2);
if (!parentId || !kind || !file) throw new Error("Usage: node examples/revise.mjs <generation UUID> <variation|remix> <output.json>");
const input = {
  prompt: "A deep house variation with warmer chords and a more spacious breakdown. Instrumental.",
  genre: "deep_house",
  revision: { parent_generation_id: parentId, kind },
};
createRequest(input);
await writeFile(file, JSON.stringify({ idempotencyKey: randomUUID(), input }, null, 2), { flag: "wx", mode: 0o600 });
console.log("Request saved. Review and edit it, then run examples/generate.mjs with this file.");
