/** Independently written client for the public MWA HTTP API. Server-side only. */
export const GENRES = Object.freeze([
  "house", "tech_house", "melodic_house", "afro_house", "deep_house",
  "progressive_house", "bass_house", "techno", "trance",
]);

const terminal = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const referenceStatuses = new Set(["upload_pending", "upload_processing", "uploaded", "analyzing", "ready", "failed", "expired", "aborted", "archived"]);
const sha256 = /^[a-f0-9]{64}$/;
const maxReferenceBytes = 50 * 1024 * 1024;

export class MwaApiError extends Error {
  constructor(message, { status = 0, code = "request_failed", requestId, retryAfterMs } = {}) {
    super(message);
    this.name = "MwaApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.retryAfterMs = retryAfterMs;
    this.retryable = status === 0 || status === 429 || status >= 500;
  }
}

function identifier(value) {
  if (typeof value !== "string" || !uuid.test(value)) throw new TypeError("Expected a generation UUID.");
  return value;
}

/** This convenience builder deliberately supports only the public MWA EDM profile. */
export function createRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("Generation input is required.");
  for (const key of Object.keys(input)) {
    if (!["prompt", "genre", "title", "revision", "referenceGuidance", "reference"].includes(key)) throw new TypeError(`Unsupported generation field: ${key}`);
  }
  if (typeof input.prompt !== "string" || !input.prompt.trim() || new TextEncoder().encode(input.prompt.trim()).length > 1500) {
    throw new TypeError("Describe your music in 1–1500 UTF-8 bytes.");
  }
  if (!GENRES.includes(input.genre)) throw new TypeError("Choose a supported electronic music genre.");
  if (input.title !== undefined && (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 120)) {
    throw new TypeError("Use a title with 1–120 characters.");
  }
  let revision;
  if (input.revision !== undefined) {
    if (!input.revision || typeof input.revision !== "object" || Array.isArray(input.revision) ||
        Object.keys(input.revision).some(key => !["parent_generation_id", "kind"].includes(key)) ||
        !["variation", "remix"].includes(input.revision.kind)) throw new TypeError("Choose variation or remix and a parent generation.");
    revision = { parent_generation_id: identifier(input.revision.parent_generation_id), kind: input.revision.kind };
  }
  let referenceGuidance;
  if (input.referenceGuidance !== undefined) {
    const guidance = input.referenceGuidance;
    if (!guidance || typeof guidance !== "object" || Array.isArray(guidance) ||
        Object.keys(guidance).some(key => key !== "mode") ||
        !["auto", "off"].includes(guidance.mode)) {
      throw new TypeError("Reference guidance accepts only mode auto or off. Audio uploads and URLs are not supported.");
    }
    referenceGuidance = { mode: guidance.mode };
  }
  let reference;
  if (input.reference !== undefined) {
    const value = input.reference;
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !["reference_id", "content_sha256"].includes(key)) || !sha256.test(value.content_sha256 ?? "") || !revision || referenceGuidance?.mode === "off")
      throw new TypeError("Use a ready uploaded reference, its SHA-256 and an owned revision with automatic guidance.");
    reference = { reference_id: identifier(value.reference_id), content_sha256: value.content_sha256 };
    referenceGuidance = { mode: "auto" };
  }
  return {
    schema_version: "music_generation_request_v1",
    model: "mwa-edm-v1",
    prompt: input.prompt.trim(),
    genre: input.genre,
    ...(input.title === undefined ? {} : { title: input.title.trim() }),
    duration_seconds: 180,
    bpm: 128,
    outputs: { project_json: true, preview_audio: true, master_audio: true, stems: "none", midi: false, presets: false },
    ...(revision ? { revision } : {}),
    ...(referenceGuidance ? { referenceGuidance } : {}),
    ...(reference ? { reference } : {}),
  };
}

function retryDelay(header) {
  if (!header) return undefined;
  const seconds = Number(header);
  const value = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(value) ? Math.max(0, value) : undefined;
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const stop = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/** No credentials are ever sent to artifact URLs or followed through redirects. */
export class MwaClient {
  #key;
  #base;
  #fetch;
  #timeout;

  constructor({ apiKey, baseUrl = "https://mixwithai.com", fetch: fetcher = globalThis.fetch, timeoutMs = 30_000 } = {}) {
    if (typeof window !== "undefined") throw new TypeError("Use MwaClient on your server. Never ship API keys to a browser.");
    if (typeof apiKey !== "string" || !apiKey.trim() || /\s/.test(apiKey)) throw new TypeError("Provide an MWA API key on your server.");
    const base = new URL(baseUrl);
    if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") {
      throw new TypeError("baseUrl must be an HTTPS origin without credentials, a path, or a query.");
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("timeoutMs must be positive.");
    this.#key = apiKey;
    this.#base = base.origin;
    this.#fetch = fetcher;
    this.#timeout = timeoutMs;
  }

  async #request(path, { method = "GET", body, idempotencyKey, signal, expectGeneration = true, resource = "generations", timeoutMs = this.#timeout } = {}) {
    if (method === "POST" && path !== "") {
      if (idempotencyKey !== undefined && (typeof idempotencyKey !== "string" || !/^[\x21-\x7E]{8,200}$/.test(idempotencyKey))) {
        throw new TypeError("Use an idempotency key with 8–200 visible ASCII characters.");
      }
    }
    const timeout = AbortSignal.timeout(timeoutMs);
    let response;
    try {
      response = await this.#fetch(`${this.#base}/api/v1/${resource}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.#key}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw new MwaApiError("Could not reach MWA. For a submission retry, reuse the same input and idempotency key.", { code: timeout.aborted ? "request_timeout" : "network_error" });
    }
    let data;
    try { data = await response.json(); } catch {
      throw new MwaApiError("MWA returned an unreadable response.", { status: response.ok ? 502 : response.status, code: "invalid_response" });
    }
    if (!response.ok) {
      const error = data?.error;
      const message = typeof error?.message === "string" ? error.message.replaceAll(this.#key, "[redacted]") : "MWA could not complete this request.";
      throw new MwaApiError(message, {
        status: response.status,
        code: typeof error?.code === "string" ? error.code : "api_error",
        requestId: typeof error?.request_id === "string" ? error.request_id : undefined,
        retryAfterMs: retryDelay(response.headers.get("retry-after")),
      });
    }
    const requestedId = /^\/([a-f0-9-]{36})(?:\/|$)/i.exec(path)?.[1];
    if (expectGeneration && (!data || !uuid.test(data.generation_id ?? "") || !["queued", "in_progress", ...terminal].includes(data.status) || (requestedId && data.generation_id.toLowerCase() !== requestedId.toLowerCase()))) {
      throw new MwaApiError("MWA returned an unexpected generation response.", { status: 502, code: "invalid_response" });
    }
    if (resource === "references" && (!data || !uuid.test(data.reference_id ?? "") || !referenceStatuses.has(data.status) || !sha256.test(data.content_sha256 ?? "") || typeof data.guidance_available !== "boolean" || requestedId && data.reference_id.toLowerCase() !== requestedId.toLowerCase()))
      throw new MwaApiError("MWA returned an unexpected reference response.", { status: 502, code: "invalid_response" });
    return data;
  }

  generate(input, { idempotencyKey, signal } = {}) {
    if (typeof idempotencyKey !== "string" || !/^[\x21-\x7E]{8,200}$/.test(idempotencyKey)) {
      throw new TypeError("Supply an idempotency key; reuse it if this submission is interrupted.");
    }
    return this.#request("", { method: "POST", body: createRequest(input), idempotencyKey, signal });
  }

  get(generationId, { signal } = {}) {
    return this.#request(`/${identifier(generationId)}`, { signal });
  }

  cancel(generationId, { signal } = {}) {
    return this.#request(`/${identifier(generationId)}/cancel`, { method: "POST", signal });
  }

  async retryExport(generationId, { idempotencyKey, signal } = {}) {
    if (!idempotencyKey || !/^[\x21-\x7E]{8,200}$/.test(idempotencyKey)) throw new TypeError("Supply an idempotency key for the export retry.");
    await this.#request(`/${identifier(generationId)}/retry-export`, { method: "POST", idempotencyKey, signal, expectGeneration: false });
    return this.get(generationId, { signal });
  }

  prepareReferenceUpload(input, { idempotencyKey, signal } = {}) {
    if (!idempotencyKey || !/^[\x21-\x7E]{8,200}$/.test(idempotencyKey) || idempotencyKey.includes(",")) throw new TypeError("Save an idempotency key for the reference upload.");
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !["generation_id", "filename", "byte_size", "duration_seconds", "content_type", "content_sha256", "user_owns_audio"].includes(key)) ||
        typeof input.filename !== "string" || input.filename.length > 240 || !/^[^\x00-\x1f\x7f/\\]+\.(wav|aiff?|flac|mp3|m4a|aac|ogg|opus)$/i.test(input.filename) ||
        !Number.isInteger(input.byte_size) || input.byte_size < 256 || input.byte_size > maxReferenceBytes ||
        !Number.isFinite(input.duration_seconds) || input.duration_seconds <= 0 || input.duration_seconds > 3600 ||
        typeof input.content_type !== "string" || input.content_type.length > 100 || !/^(audio\/[a-z0-9.+-]+|application\/octet-stream)$/i.test(input.content_type) ||
        !sha256.test(input.content_sha256 ?? "") || input.user_owns_audio !== true)
      throw new TypeError("Provide valid owned audio metadata: 256 bytes to 50 MiB, duration up to one hour, and SHA-256.");
    identifier(input.generation_id);
    return this.#request("", { resource: "references", expectGeneration: false, method: "POST", body: input, idempotencyKey, signal });
  }

  getReference(referenceId, { signal } = {}) {
    return this.#request(`/${identifier(referenceId)}`, { resource: "references", expectGeneration: false, signal });
  }

  completeReferenceUpload(referenceId, { signal, timeoutMs = 300_000 } = {}) {
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("Use a positive finalization timeout.");
    return this.#request(`/${identifier(referenceId)}/complete`, { resource: "references", expectGeneration: false, method: "POST", signal, timeoutMs });
  }

  removeReference(referenceId, { signal } = {}) {
    return this.#request(`/${identifier(referenceId)}`, { resource: "references", expectGeneration: false, method: "DELETE", signal });
  }

  /** Exact-object transfer: the signed Storage request never carries the MWA key. */
  async uploadReference(generationId, audio, { filename, durationSeconds, userOwnsAudio, idempotencyKey, signal, uploadTimeoutMs = 300_000 } = {}) {
    identifier(generationId);
    if (!(audio instanceof Blob) || audio.size < 256 || audio.size > maxReferenceBytes || !Number.isInteger(uploadTimeoutMs) || uploadTimeoutMs < 1)
      throw new TypeError("Use an audio Blob of 256 bytes to 50 MiB and a positive upload timeout.");
    signal?.throwIfAborted();
    const bytes = await audio.arrayBuffer();
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), value => value.toString(16).padStart(2, "0")).join("");
    const prepared = await this.prepareReferenceUpload({ generation_id: generationId, filename, duration_seconds: durationSeconds,
      user_owns_audio: userOwnsAudio, byte_size: audio.size, content_type: audio.type || "application/octet-stream", content_sha256: digest }, { idempotencyKey, signal });
    if (prepared.upload) {
      let url;
      try { url = new URL(prepared.upload.url); } catch { throw new MwaApiError("Invalid reference upload URL.", { code: "invalid_response", status: 502 }); }
      if (url.protocol !== "https:" || url.username || url.password || url.hash || prepared.upload.method !== "PUT")
        throw new MwaApiError("Invalid reference upload authority.", { code: "invalid_response", status: 502 });
      const timeout = AbortSignal.timeout(uploadTimeoutMs);
      let response;
      try { response = await this.#fetch(url.href, { method: "PUT", body: audio, redirect: "error", headers: { "Content-Type": audio.type || "application/octet-stream" }, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }); }
      catch { if (signal?.aborted) throw signal.reason; throw new MwaApiError("The reference transfer was interrupted. Recover using the same file, metadata and upload key.", { code: "reference_upload_interrupted" }); }
      if (!response.ok && response.status !== 409) throw new MwaApiError("The reference transfer could not finish. Inspect this upload before retrying.", { status: response.status, code: "reference_upload_failed" });
    }
    if (["ready", "analyzing", "failed"].includes(prepared.status) && !prepared.upload) return prepared;
    if (["archived", "aborted", "expired"].includes(prepared.status)) return prepared;
    return this.completeReferenceUpload(prepared.reference_id, { signal });
  }

  async waitForReference(referenceId, { pollIntervalMs = 3000, timeoutMs = 15 * 60_000, signal, onProgress } = {}) {
    identifier(referenceId);
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 10 || !Number.isInteger(timeoutMs) || timeoutMs < 1) throw new TypeError("Use positive reference polling options.");
    const timeout = AbortSignal.timeout(timeoutMs);
    const waiting = signal ? AbortSignal.any([signal, timeout]) : timeout;
    while (true) {
      waiting.throwIfAborted();
      let receipt;
      try { receipt = await this.getReference(referenceId, { signal: waiting }); }
      catch (error) { if (!(error instanceof MwaApiError) || !error.retryable) throw error; await sleep(Math.max(pollIntervalMs, error.retryAfterMs ?? 0), waiting); continue; }
      await onProgress?.(receipt);
      if (["ready", "failed", "expired", "aborted", "archived"].includes(receipt.status)) return receipt;
      await sleep(pollIntervalMs, waiting);
    }
  }

  /** Returns failures/cancellations as statuses. Timeout stops waiting, not the remote job. */
  async wait(generationId, { pollIntervalMs = 3000, timeoutMs = 15 * 60_000, signal, onProgress, waitForAudio = false } = {}) {
    identifier(generationId);
    if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 10 || !Number.isFinite(timeoutMs) || timeoutMs < 1) throw new TypeError("Use a positive wait timeout and a polling interval of at least 10 ms.");
    if (typeof waitForAudio !== "boolean") throw new TypeError("waitForAudio must be a boolean.");
    const waiting = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
    while (true) {
      waiting.throwIfAborted();
      let status;
      try { status = await this.get(generationId, { signal: waiting }); } catch (error) {
        if (!(error instanceof MwaApiError) || !error.retryable) throw error;
        await sleep(Math.max(pollIntervalMs, error.retryAfterMs ?? 0), waiting);
        continue;
      }
      await onProgress?.(status);
      const recoveringAudio = waitForAudio && status.audio_export?.status === "processing";
      if (status.status === "cancelled" || (status.status === "failed" && !recoveringAudio) || (terminal.has(status.status) && status.audio_export?.status !== "processing")) return status;
      await sleep(pollIntervalMs, waiting);
    }
  }
}
