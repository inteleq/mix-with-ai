import { GENRES } from "../packages/sdk/index.js";

const demoPrompt = "A late-night tech house track with a rolling bassline, crisp percussion, a spacious breakdown, and a punchy final drop. Instrumental.";
export const COMPARISON_DEMOS = Object.freeze([
  { id: "demo-after-hours", title: "After hours / A", genre: "tech_house", prompt: demoPrompt, source: "starter_demo", variant: "original", audioUrl: "/api/showcase/audio/demo-after-hours" },
  { id: "demo-after-hours-variation", title: "After hours / B", genre: "tech_house", prompt: "Keep the late-night energy with a brighter melodic pattern and a lighter percussion feel. Instrumental.", source: "starter_demo", variant: "variation", parentId: "demo-after-hours", audioUrl: "/api/showcase/audio/demo-after-hours-variation" },
]);

function publicAudioUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
        host === "localhost" || host.endsWith(".local") || host.includes(":") ||
        /^(?:127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.href;
  } catch { return null; }
}

/** Only explicit, publication-approved public metadata enters the showcase. */
export function readShowcase(value) {
  if (!value || typeof value !== "object" || Object.keys(value).some(key => key !== "tracks") || !Array.isArray(value.tracks) || value.tracks.length > 12) throw new TypeError("showcase.json must contain a tracks array with at most 12 entries.");
  const ids = new Set();
  const tracks = value.tracks.map(item => {
    if (!item || typeof item !== "object" || Object.keys(item).some(key => !["id", "title", "genre", "prompt", "audioUrl", "credit", "publicationApproved", "variantOf"].includes(key))) throw new TypeError("Showcase entries must contain only public track metadata.");
    if (typeof item.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(item.id) || item.id.startsWith("demo-") || ids.has(item.id)) throw new TypeError("Each showcase track needs a unique public slug, without the reserved demo- prefix.");
    if (item.variantOf !== undefined && (typeof item.variantOf !== "string" || !item.variantOf)) throw new TypeError("variantOf must be another published track's public slug.");
    if (item.publicationApproved !== true) throw new TypeError("Showcase audio needs explicit publicationApproved: true.");
    if (!GENRES.includes(item.genre)) throw new TypeError("Choose a supported showcase genre.");
    for (const [key, max] of [["title", 120], ["credit", 200]]) {
      if (typeof item[key] !== "string" || !item[key].trim() || item[key].length > max) throw new TypeError(`Showcase ${key} is missing or too long.`);
    }
    if (item.prompt !== undefined && (typeof item.prompt !== "string" || !item.prompt.trim() || new TextEncoder().encode(item.prompt.trim()).length > 1500)) throw new TypeError("A shared showcase prompt must contain 1–1500 UTF-8 bytes.");
    const audioUrl = publicAudioUrl(item.audioUrl);
    if (!audioUrl) throw new TypeError("Showcase audio needs a permanent public HTTPS URL without credentials, signed queries, or fragments.");
    ids.add(item.id);
    return { id: item.id, title: item.title.trim(), genre: item.genre, prompt: item.prompt?.trim() || null, audioUrl, credit: item.credit.trim(), source: "mwa_api", ...(item.variantOf ? { parentId: item.variantOf } : {}) };
  });
  for (const item of tracks) if (item.parentId && (!ids.has(item.parentId) || item.parentId === item.id)) throw new TypeError("A showcase variantOf must identify another published track.");
  return tracks;
}
