import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { MwaClient, MwaApiError, createRequest } from "../packages/sdk/index.js";
import { DemoService } from "./demo.mjs";
import { renderDemoAudio } from "./demo-audio.mjs";
import { COMPARISON_DEMOS, readShowcase } from "./showcase.mjs";
import { cleanProject, buildContextPrompt, PROJECT_LIMITS } from "../public/project-context.mjs";
import { createAbletonImportRoutes } from "./ableton-imports.mjs";
import { workflowReadiness, prepareWorkflow } from "./workflows.mjs";

const root = new URL("../", import.meta.url);
const files = new Map([
  ["/", ["public/index.html", "text/html; charset=utf-8"]],
  ["/workflows", ["public/workflows.html", "text/html; charset=utf-8"]],
  ["/workflows.js", ["public/workflows.js", "text/javascript; charset=utf-8"]],
  ["/workflows.css", ["public/workflows.css", "text/css; charset=utf-8"]],
  ["/workflow-templates.mjs", ["public/workflow-templates.mjs", "text/javascript; charset=utf-8"]],
  ["/docs/workflows.md", ["docs/workflows.md", "text/plain; charset=utf-8"]],
  ["/examples/workflows/create-idea.json", ["examples/workflows/create-idea.json", "application/json; charset=utf-8"]],
  ["/examples/workflows/teacher-lesson.json", ["examples/workflows/teacher-lesson.json", "application/json; charset=utf-8"]],
  ["/project", ["public/project.html", "text/html; charset=utf-8"]],
  ["/project.js", ["public/project.js", "text/javascript; charset=utf-8"]],
  ["/ableton-import.js", ["public/ableton-import.js", "text/javascript; charset=utf-8"]],
  ["/project-context.mjs", ["public/project-context.mjs", "text/javascript; charset=utf-8"]],
  ["/project.css", ["public/project.css", "text/css; charset=utf-8"]],
  ["/app.js", ["public/app.js", "text/javascript; charset=utf-8"]],
  ["/code-examples.js", ["public/code-examples.js", "text/javascript; charset=utf-8"]],
  ["/comparison.js", ["public/comparison.js", "text/javascript; charset=utf-8"]],
  ["/share-card.js", ["public/share-card.js", "text/javascript; charset=utf-8"]],
  ["/generation-state.js", ["public/generation-state.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["public/styles.css", "text/css; charset=utf-8"]],
  ["/assets/cover.svg", ["public/assets/cover.svg", "image/svg+xml"]],
  ["/assets/favicon.svg", ["public/assets/favicon.svg", "image/svg+xml"]],
  ["/social-card.svg", ["marketing/social-card.svg", "image/svg+xml"]],
  ["/README.md", ["README.md", "text/plain; charset=utf-8"]],
  ["/docs/api.md", ["docs/api.md", "text/plain; charset=utf-8"]],
  ["/docs/build-with-mwa.md", ["docs/build-with-mwa.md", "text/plain; charset=utf-8"]],
  ["/docs/showcase.md", ["docs/showcase.md", "text/plain; charset=utf-8"]],
  ["/docs/comparison.md", ["docs/comparison.md", "text/plain; charset=utf-8"]],
  ["/docs/setup-and-sharing.md", ["docs/setup-and-sharing.md", "text/plain; charset=utf-8"]],
  ["/docs/ableton-projects.md", ["docs/ableton-projects.md", "text/plain; charset=utf-8"]],
  ["/docs/ableton-audio-import.md", ["docs/ableton-audio-import.md", "text/plain; charset=utf-8"]],
]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const ended = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);
const httpError = (status, message) => Object.assign(new Error(message), { status });
const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const safeUrl = value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
};

async function readJson(req, limit = 8192) {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw httpError(415, "Use application/json.");
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw httpError(413, "Request is too large.");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw httpError(400, "Invalid JSON."); }
}

function present(job, mode, input = {}) {
  const project = job.studio_project;
  const studioUrl = project && uuid.test(project.chat_id) && uuid.test(project.playlist_id)
    ? `https://mixwithai.com/chat/${project.chat_id}/version/${project.playlist_id}` : null;
  const audio = job.audio_export;
  const audioUrl = mode === "demo" ? audio?.download_url : safeUrl(audio?.download_url);
  const projectArtifact = job.artifact_manifest?.artifacts?.find(item => item.kind === "project_json" && item.status === "ready");
  return {
    generation_id: job.generation_id,
    status: job.status,
    stage: job.stage || "queued",
    progress: Math.max(0, Math.min(1, Number(job.progress) || 0)),
    demo: mode === "demo",
    title: input.title || "Untitled track",
    genre: input.genre || null,
    parentId: input.revision?.parent_generation_id || null,
    revisionKind: input.revision?.kind || null,
    audio: { status: audio?.status || "unavailable", url: audioUrl || null, canRetry: audio?.can_retry === true, expiresAt: audio?.download_url_expires_at || null },
    studioUrl,
    projectUrl: safeUrl(projectArtifact?.download_url),
    error: job.error ? { code: job.error.code, message: job.error.message } : null,
    warnings: (job.result?.warnings || []).map(item => String(item.message)),
  };
}

function sendAudio(req, res, buffer, filename) {
  res.setHeader("Content-Type", "audio/wav");
  res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
  res.setHeader("Accept-Ranges", "bytes");
  let start = 0, end = buffer.length - 1;
  if (req.headers.range) {
    const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
    if (!range) { res.writeHead(416, { "Content-Range": `bytes */${buffer.length}` }); res.end(); return; }
    start = Number(range[1]); end = range[2] ? Math.min(Number(range[2]), end) : end;
    if (start > end || start >= buffer.length) { res.writeHead(416, { "Content-Range": `bytes */${buffer.length}` }); res.end(); return; }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${buffer.length}`);
  }
  res.setHeader("Content-Length", end - start + 1); res.end(buffer.subarray(start, end + 1));
}

export function createStarterServer(config, { service, now = Date.now, showcase = { tracks: [] }, readProject, audioImporter, importStore } = {}) {
  if (readProject && (config.host !== "127.0.0.1" || config.publicOrigin)) throw new Error("The Ableton reader requires a loopback-only starter without PUBLIC_ORIGIN.");
  if (audioImporter && (config.mode !== "live" || config.host !== "127.0.0.1" || config.publicOrigin)) throw new Error("Audio import requires explicitly enabled live mode on a loopback-only starter.");
  const publicTracks = readShowcase(showcase);
  const music = service || (config.mode === "demo" ? new DemoService() : new MwaClient({ apiKey: config.apiKey }));
  const sessions = new Map();
  const audioCache = new Map();
  const globalSubmissions = [];
  const MAX_SESSIONS = 500;
  const SESSION_AGE = 24 * 60 * 60_000;
  let inFlightSubmissions = 0;
  let capturingProject = false;
  async function runExclusive(action) {
    if (capturingProject) throw httpError(409, "The Ableton connector is busy. Wait before trying again.");
    capturingProject = true;
    try { return await action(); } finally { capturingProject = false; }
  }

  function json(res, status, value) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(value)); }
  const importRoutes = createAbletonImportRoutes({ music, importer: audioImporter, store: importStore, now, runExclusive, readJson, json });
  function cleanup() {
    for (const [id, session] of sessions) if (now() - session.touched > SESSION_AGE) {
      if (config.mode === "demo") for (const jobId of session.jobs.keys()) music.jobs.delete(jobId);
      sessions.delete(id);
    }
    while (globalSubmissions.length && now() - globalSubmissions[0] > 3_600_000) globalSubmissions.shift();
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; media-src 'self' https:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      const port = server.address()?.port;
      const allowed = config.publicOrigin ? [config.publicOrigin] : [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
      if (!allowed.some(origin => new URL(origin).host === req.headers.host)) throw httpError(403, "Unrecognized host.");
      const path = new URL(req.url, allowed[0]).pathname;
      if (req.method === "GET" && files.has(path)) {
        const [filename, mime] = files.get(path);
        const content = await readFile(new URL(filename, root));
        res.writeHead(200, { "Content-Type": mime }); res.end(content); return;
      }
      if (!path.startsWith("/api/")) throw httpError(404, "Not found.");
      if (req.headers.origin && !allowed.includes(req.headers.origin)) throw httpError(403, "Cross-origin requests are not allowed.");
      if (req.headers["sec-fetch-site"] === "cross-site") throw httpError(403, "Cross-site requests are not allowed.");
      if (path === "/api/showcase" && req.method === "GET") {
        json(res, 200, { tracks: publicTracks, comparisonDemos: COMPARISON_DEMOS }); return;
      }
      const publicDemo = path.match(/^\/api\/showcase\/audio\/([a-z0-9-]+)$/);
      if (publicDemo && req.method === "GET") {
        const track = COMPARISON_DEMOS.find(item => item.id === publicDemo[1]);
        if (!track) throw httpError(404, "Demo not found.");
        const key = `${track.genre}:${track.variant}`;
        if (!audioCache.has(key)) audioCache.set(key, renderDemoAudio(track.genre, track.variant));
        sendAudio(req, res, audioCache.get(key), `${track.id}.wav`); return;
      }
      cleanup();
      const cookie = req.headers.cookie?.split(";").map(x => x.trim()).find(x => x.startsWith("mwa_starter="))?.slice(12);
      let session = sessions.get(cookie);
      if (path === "/api/config" && req.method === "GET") {
        if (!session) {
          if (sessions.size >= MAX_SESSIONS) throw httpError(503, "Preview is busy. Please try again later.");
          const id = randomBytes(24).toString("hex");
          session = { csrf: randomBytes(24).toString("hex"), touched: now(), jobs: new Map(), requests: new Map(), submissions: [], handoffs: new Map(), workflowHandoffs: new Map() };
          sessions.set(id, session);
          res.setHeader("Set-Cookie", `mwa_starter=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400${config.publicOrigin ? "; Secure" : ""}`);
        }
        session.touched = now();
        const params = new URLSearchParams({ utm_source: "github", utm_medium: "starter", utm_campaign: config.campaign });
        json(res, 200, {
          mode: config.mode, csrf: session.csrf, repositoryUrl: config.repositoryUrl, campaign: config.campaign, abletonReaderAvailable: Boolean(readProject), abletonImportAvailable: Boolean(audioImporter),
          apiAccessUrl: `https://mixwithai.com/settings/api?${params}`,
          appUrl: `https://mixwithai.com/?${params}`,
          recent: [...session.jobs.entries()].map(([id, job]) => ({ id, title: job.input.title || "Untitled track", genre: job.input.genre, prompt: job.input.prompt, ...(job.input.revision ? { revision: job.input.revision } : {}) })).reverse().slice(0, 20),
        }); return;
      }
      if (!session) throw httpError(401, "This local session expired. Reload the page to begin again.");
      session.touched = now();
      if (!path.startsWith("/api/demo-audio/") && req.headers["x-starter-csrf"] !== session.csrf) throw httpError(403, "Reload the page and retry.");

      if (path === "/api/workflows/readiness" && req.method === "GET") {
        json(res, 200, workflowReadiness(config, { audioImportAvailable: Boolean(audioImporter) })); return;
      }
      if (["/api/workflows/prepare", "/api/workflows/handoff"].includes(path) && req.method === "POST") {
        let prepared;
        try { prepared = prepareWorkflow(await readJson(req), session.jobs); }
        catch (failure) { if (failure.status) throw failure; throw httpError(400, failure.message); }
        if (path.endsWith("/prepare")) {
          json(res, 200, { input: prepared.input, ...workflowReadiness(config).generation }); return;
        }
        const id = randomUUID();
        if (session.workflowHandoffs.size >= 10) session.workflowHandoffs.delete(session.workflowHandoffs.keys().next().value);
        session.workflowHandoffs.set(id, prepared.input);
        json(res, 200, { id, url: `/?workflow=${id}#studio`, message: "Review this request in the developer playground. No generation was submitted." }); return;
      }
      const workflowHandoff = path.match(/^\/api\/workflows\/handoff\/([a-f0-9-]+)$/i);
      if (workflowHandoff && req.method === "GET") {
        const input = session.workflowHandoffs.get(workflowHandoff[1]);
        if (!input) throw httpError(404, "Workflow handoff is not in this local session.");
        json(res, 200, { input }); return;
      }

      if (path.startsWith("/api/ableton/")) { await importRoutes(path, req, res, session); return; }

      if (path === "/api/project/capture" && req.method === "POST") {
        if (!readProject) throw httpError(409, "Start the optional reader with npm run ableton after its setup. JSON import and the demo work without Live.");
        await readJson(req);
        if (capturingProject) throw httpError(409, "A capture is already running. Wait before trying again.");
        capturingProject = true;
        try {
          const captured = await readProject();
          json(res, 200, { project: cleanProject(captured.project), warnings: captured.warnings, atomic: false });
        } catch {
          throw httpError(502, "Could not read a bounded Live snapshot. Run npm run ableton:setup, check the matching AbletonJS script, stop other connectors, keep the set idle, and retry. No Live edits were requested.");
        } finally { capturingProject = false; }
        return;
      }
      if (["/api/project/clean", "/api/project/handoff"].includes(path) && req.method === "POST") {
        const body = await readJson(req, PROJECT_LIMITS.bytes);
        try {
          const project = cleanProject(body.project);
          if (path.endsWith("/clean")) { json(res, 200, { project }); return; }
          const prepared = buildContextPrompt(project, { includeNames: body.includeNames === true, intent: body.intent });
          const id = randomUUID();
          if (session.handoffs.size >= 10) session.handoffs.delete(session.handoffs.keys().next().value);
          const handoff = { id, prompt: prepared.prompt, context: prepared.context, source: project.source };
          // Retain only the prompt for navigation; full cleaned context stays in the response preview.
          session.handoffs.set(id, { id, prompt: prepared.prompt, source: project.source });
          json(res, 200, handoff); return;
        } catch (error) { throw httpError(400, error.message); }
      }
      const handoffMatch = path.match(/^\/api\/project\/handoff\/([a-f0-9-]+)$/i);
      if (handoffMatch && req.method === "GET") {
        const handoff = session.handoffs.get(handoffMatch[1]);
        if (!handoff) throw httpError(404, "Project handoff not found in this session. Restarting the starter resets local handoffs.");
        json(res, 200, handoff); return;
      }

      if (["/api/generations", "/api/workflows/run"].includes(path) && req.method === "POST") {
        let body = await readJson(req);
        if (path === "/api/workflows/run") {
          if (config.mode !== "demo") throw httpError(409, "Guided live runs need verified account access and an authoritative price quote. No generation was submitted.");
          try { body = prepareWorkflow(body, session.jobs).input; }
          catch (failure) { throw httpError(400, failure.message); }
        }
        let normalized;
        try { normalized = createRequest(body); } catch (error) { throw httpError(400, error.message); }
        if (body.revision && !session.jobs.has(body.revision.parent_generation_id)) throw httpError(404, "Parent generation is not in this session.");
        const key = req.headers["idempotency-key"];
        if (typeof key !== "string" || !/^[\x21-\x7E]{8,200}$/.test(key)) throw httpError(400, "A valid idempotency key is required.");
        const fingerprint = digest(normalized);
        let record = session.requests.get(key);
        if (record && record.fingerprint !== fingerprint) throw httpError(409, "This request key belongs to a different prompt. Start a new generation.");
        if (!record) {
          session.submissions = session.submissions.filter(time => now() - time < 3_600_000);
          if (session.submissions.length >= 10 || session.requests.size >= 100 || (config.mode === "live" && globalSubmissions.length >= 10)) throw httpError(429, "Starter limit reached. Try again in an hour.");
          if (inFlightSubmissions > 0 || [...session.jobs.values()].some(job => !ended.has(job.status))) throw httpError(409, "Wait for the current generation before starting another.");
          record = { fingerprint, input: body, promise: null, result: null };
          session.requests.set(key, record);
          session.submissions.push(now()); globalSubmissions.push(now());
        }
        if (!record.result && !record.promise) {
          inFlightSubmissions++;
          record.promise = music.generate(record.input, { idempotencyKey: key })
            .then(job => {
              record.result = job;
              session.jobs.set(job.generation_id, { input: record.input, status: job.status, audioReady: job.audio_export?.status === "ready" });
              return job;
            })
            .finally(() => { inFlightSubmissions--; record.promise = null; });
        }
        json(res, 202, present(record.result || await record.promise, config.mode, record.input)); return;
      }

      const match = path.match(/^\/api\/generations\/([a-f0-9-]+)(?:\/(cancel|retry-export))?$/i);
      if (match && uuid.test(match[1])) {
        const [, id, action] = match;
        const owned = session.jobs.get(id);
        if (!owned) throw httpError(404, "Generation not found in this session. Restarting the starter resets its local history.");
        let job;
        if (!action && req.method === "GET") job = await music.get(id);
        else if (action === "cancel" && req.method === "POST") {
          await readJson(req);
          job = await music.cancel(id);
        } else if (action === "retry-export" && req.method === "POST") {
          await readJson(req);
          const key = req.headers["idempotency-key"];
          if (typeof key !== "string" || !/^[\x21-\x7E]{8,200}$/.test(key)) throw httpError(400, "A retry idempotency key is required.");
          if (config.mode === "demo") throw httpError(409, "Export recovery is available for eligible live generations.");
          job = await music.retryExport(id, { idempotencyKey: key });
        } else throw httpError(405, "Method not allowed.");
        owned.status = job.status;
        owned.audioReady = job.audio_export?.status === "ready";
        json(res, 200, present(job, config.mode, owned.input)); return;
      }

      const demoAudio = path.match(/^\/api\/demo-audio\/([a-f0-9-]+)$/i);
      if (config.mode === "demo" && req.method === "GET" && demoAudio) {
        const owned = session.jobs.get(demoAudio[1]);
        if (!owned || (await music.get(demoAudio[1])).status !== "completed") throw httpError(404, "Preview not found.");
        const variant = owned.input.revision?.kind || "original";
        const key = `${owned.input.genre}:${variant}`;
        if (!audioCache.has(key)) audioCache.set(key, renderDemoAudio(owned.input.genre, variant));
        sendAudio(req, res, audioCache.get(key), "mwa-starter-preview.wav"); return;
      }
      throw httpError(404, "Not found.");
    } catch (error) {
      if (res.headersSent) { res.end(); return; }
      const known = error instanceof MwaApiError || Number.isInteger(error.status);
      const status = known ? (error.status || 502) : 500;
      const message = known ? error.message : "The starter could not complete this request. Please retry.";
      if (error.retryAfterMs) res.setHeader("Retry-After", String(Math.ceil(error.retryAfterMs / 1000)));
      json(res, status, { error: { message, code: error instanceof MwaApiError ? error.code : "starter_error", retryable: error instanceof MwaApiError ? error.retryable : false } });
    }
  });
  server.requestTimeout = 35_000;
  server.headersTimeout = 10_000;
  return server;
}
