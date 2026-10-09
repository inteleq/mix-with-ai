// Offline preparation only. This script never creates a generation.
import { readFile, stat } from "node:fs/promises";
import { cleanLesson, workflowRequest } from "../../public/workflow-templates.mjs";

const args = process.argv.slice(2);
try {
  if (args[0] !== "--template" || !args[1] || ![2, 4].includes(args.length) || args.length === 4 && args[2] !== "--parent") throw new Error("Usage: node examples/workflows/prepare.mjs --template public-template.json [--parent OWNED_READY_GENERATION_UUID]");
  if ((await stat(args[1])).size > 8192) throw new Error("Use a public JSON template under 8 KiB.");
  const value = JSON.parse(await readFile(args[1], "utf8"));
  const template = value.schema_version === "mwa_workflow_lesson_v1" ? cleanLesson(value).template : value;
  console.log(JSON.stringify(workflowRequest(template, args[3]), null, 2));
} catch (failure) { console.error(failure instanceof SyntaxError ? "The template is not valid JSON." : failure.message); process.exitCode = 1; }
