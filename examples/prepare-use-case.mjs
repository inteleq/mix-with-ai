import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { createRequest } from "../packages/sdk/index.js";
import { getUseCase, buildUseCaseInput } from "./use-cases/catalog.mjs";
import { readJson, createReceipt } from "./receipts.mjs";

// Local preparation only. Submission is a separate, intentional command.
const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  parent: { type: "string" }, output: { type: "string" }, "reference-receipt": { type: "string" },
} });
if (positionals.length !== 1) throw new Error("Usage: node examples/prepare-use-case.mjs <recipe> [--parent UUID] [--reference-receipt file] [--output file]");
const recipe = getUseCase(positionals[0]);
const referenceReceipt = values["reference-receipt"] ? await readJson(values["reference-receipt"]) : undefined;
const input = buildUseCaseInput(recipe.id, { parentGenerationId: values.parent, referenceReceipt });
createRequest(input);
const file = values.output ?? `.mwa-examples/request-${recipe.id}.json`;
await createReceipt(file, { idempotencyKey: randomUUID(), input });
console.log(`${recipe.title}: request saved to ${file}. No API request was made.`);
console.log(recipe.limit);
console.log("Review the saved input before submitting with examples/generate.mjs. Generation uses API credits.");
