// Public configuration only. No executable workflow, URLs, credentials or DAW commands.
export const WORKFLOW_GENRES = Object.freeze(["house", "tech_house", "melodic_house", "afro_house", "deep_house", "progressive_house", "bass_house", "techno", "trance"]);
export const WORKFLOW_CARDS = Object.freeze([
  Object.freeze({ id: "create-idea", name: "Create an idea", description: "Describe a mood and make a new electronic track.", output: "Full audio + project JSON · 180 seconds · 128 BPM", genre: "deep_house", prompt: "A warm deep house track with soft chords, a rounded bass groove and a spacious sunset breakdown. Instrumental." }),
  Object.freeze({ id: "make-variation", name: "Make a variation", description: "Explore another direction from a ready track in this session.", output: "A new full-audio version · 180 seconds · 128 BPM", genre: "tech_house", prompt: "Keep the original character with brighter melodic details, lighter percussion and a more spacious breakdown. Instrumental." }),
  Object.freeze({ id: "bring-to-ableton", name: "Bring a result into Ableton", description: "Choose ready audio, review an empty track, then approve placement.", output: "One full-audio clip · existing Set tempo stays unchanged", genre: "deep_house", prompt: "A warm deep house track with soft chords and a rounded bass groove. Instrumental." }),
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const bytes = value => new TextEncoder().encode(value).length;
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new TypeError("Use only the documented workflow fields.");
}
function text(value, limit, label) {
  if (typeof value !== "string" || !value.trim() || bytes(value.trim()) > limit || /[\u0000-\u001f\u007f]/.test(value.replace(/[\n\r\t]/g, ""))) throw new TypeError(`${label} needs 1–${limit} UTF-8 bytes.`);
  // A convenience guard, not a general detector of confidential text.
  if (/mwa_(?:live|test)_[A-Za-z0-9_-]{20,}|-----BEGIN .*PRIVATE KEY-----|Bearer\s+[A-Za-z0-9_.-]{20,}/i.test(value)) throw new TypeError("Remove credentials before saving or sharing a workflow.");
  return value.trim();
}
export function defaultTemplate(id = "create-idea") {
  const card = WORKFLOW_CARDS.find(item => item.id === id);
  if (!card) throw new TypeError("Choose a supported workflow.");
  return { schema_version: "mwa_workflow_template_v1", workflow: card.id, name: card.name, genre: card.genre, prompt: card.prompt };
}
export function cleanWorkflowTemplate(value) {
  object(value, ["schema_version", "workflow", "name", "genre", "prompt"]);
  if (value.schema_version !== "mwa_workflow_template_v1" || !WORKFLOW_CARDS.some(item => item.id === value.workflow)) throw new TypeError("Unsupported workflow template.");
  if (!WORKFLOW_GENRES.includes(value.genre)) throw new TypeError("Choose a supported electronic genre.");
  return { schema_version: "mwa_workflow_template_v1", workflow: value.workflow, name: text(value.name, 120, "Workflow name"), genre: value.genre, prompt: text(value.prompt, 1500, "Prompt") };
}
export function workflowRequest(value, parentId) {
  const template = cleanWorkflowTemplate(value);
  if (template.workflow === "bring-to-ableton") throw new TypeError("Audio import uses a separate reviewed plan, never a generation request.");
  if (template.workflow === "create-idea" && parentId !== undefined) throw new TypeError("A new idea cannot include a parent generation.");
  if (template.workflow === "make-variation" && (typeof parentId !== "string" || !uuid.test(parentId))) throw new TypeError("Choose a ready original from this local session.");
  return { prompt: template.prompt, genre: template.genre, title: template.name, ...(template.workflow === "make-variation" ? { revision: { kind: "variation", parent_generation_id: parentId } } : {}) };
}
export function cleanLesson(value) {
  object(value, ["schema_version", "title", "teacher", "objective", "template", "example_id"]);
  if (value.schema_version !== "mwa_workflow_lesson_v1") throw new TypeError("Unsupported lesson format.");
  if (value.example_id !== undefined && (typeof value.example_id !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(value.example_id))) throw new TypeError("Use a published showcase example ID.");
  return { schema_version: value.schema_version, title: text(value.title, 120, "Lesson title"), teacher: text(value.teacher, 120, "Teacher attribution"), objective: text(value.objective, 500, "Lesson objective"), template: cleanWorkflowTemplate(value.template), ...(value.example_id ? { example_id: value.example_id } : {}) };
}
export function encodeLesson(value) {
  const data = new TextEncoder().encode(JSON.stringify(cleanLesson(value)));
  if (data.length > 4096) throw new TypeError("This lesson is too large to share as a link.");
  return btoa(String.fromCharCode(...data)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
export function decodeLesson(token) {
  if (typeof token !== "string" || token.length > 5500 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new TypeError("Invalid or oversized lesson link.");
  let value;
  try {
    const decoded = atob(token.replaceAll("-", "+").replaceAll("_", "/"));
    if (decoded.length > 4096) throw new Error();
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(decoded, char => char.charCodeAt(0))));
  } catch { throw new TypeError("This lesson link could not be read."); }
  return cleanLesson(value);
}
