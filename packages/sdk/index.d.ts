export type Genre = "house" | "tech_house" | "melodic_house" | "afro_house" | "deep_house" | "progressive_house" | "bass_house" | "techno" | "trance";
export const GENRES: readonly Genre[];
export type GenerationStatus = "queued" | "in_progress" | "completed" | "completed_with_errors" | "failed" | "cancelled";
export interface ReferenceGuidance { mode: "auto" | "off" }
export interface ReferenceSelection { reference_id: string; content_sha256: string }
export interface GenerationInput {
  prompt: string;
  genre: Genre;
  title?: string;
  referenceGuidance?: ReferenceGuidance;
  reference?: ReferenceSelection;
  revision?: { parent_generation_id: string; kind: "variation" | "remix" };
}
export interface GenerationRequest extends GenerationInput {
  schema_version: "music_generation_request_v1";
  model: "mwa-edm-v1";
  duration_seconds: 180;
  bpm: 128;
  outputs: { project_json: true; preview_audio: true; master_audio: true; stems: "none"; midi: false; presets: false };
}
export interface GenerationAccepted {
  generation_id: string;
  status: GenerationStatus;
  schema_version: string;
  object: "music_generation";
  status_url: string;
  created_at: string;
}
export interface Artifact {
  artifact_id: string;
  kind: string;
  status: "ready" | "failed" | "skipped";
  filename?: string;
  download_url?: string;
  download_url_expires_at?: string;
  content_type?: string;
  byte_size?: number;
  checksum_sha256?: string;
}
export interface Generation extends GenerationAccepted {
  stage: string;
  progress: number;
  cancel_url: string;
  studio_project?: { chat_id: string; project_id: string; playlist_id: string; operation_id: string; version: string; parent_generation_id: string | null; revision_kind: "variation" | "remix" | null } | null;
  audio_export?: { status: "unavailable" | "processing" | "ready" | "failed" | "expired"; can_retry: boolean; download_url?: string; download_url_expires_at?: string; stable_download_path?: string } | null;
  artifact_manifest?: { artifacts: Artifact[] } | null;
  error?: { code: string; message: string; retryable: boolean } | null;
  result?: { warnings?: { code: string; message: string }[] } | null;
}
export class MwaApiError extends Error {
  status: number;
  code: string;
  requestId?: string;
  retryAfterMs?: number;
  retryable: boolean;
  constructor(message: string, options?: { status?: number; code?: string; requestId?: string; retryAfterMs?: number });
}
export function createRequest(input: GenerationInput): GenerationRequest;
export class MwaClient {
  constructor(options: { apiKey: string; baseUrl?: string; fetch?: typeof globalThis.fetch; timeoutMs?: number });
  generate(input: GenerationInput, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<GenerationAccepted>;
  get(generationId: string, options?: { signal?: AbortSignal }): Promise<Generation>;
  cancel(generationId: string, options?: { signal?: AbortSignal }): Promise<Generation>;
  retryExport(generationId: string, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<Generation>;
  prepareReferenceUpload(input: ReferenceUploadMetadata, options: { idempotencyKey: string; signal?: AbortSignal }): Promise<ReferenceReceipt>;
  uploadReference(generationId: string, audio: Blob, options: { filename: string; durationSeconds: number; userOwnsAudio: true; idempotencyKey: string; signal?: AbortSignal; uploadTimeoutMs?: number }): Promise<ReferenceReceipt>;
  getReference(referenceId: string, options?: { signal?: AbortSignal }): Promise<ReferenceReceipt>;
  completeReferenceUpload(referenceId: string, options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<ReferenceReceipt>;
  removeReference(referenceId: string, options?: { signal?: AbortSignal }): Promise<ReferenceReceipt>;
  waitForReference(referenceId: string, options?: { pollIntervalMs?: number; timeoutMs?: number; signal?: AbortSignal; onProgress?: (reference: ReferenceReceipt) => void | Promise<void> }): Promise<ReferenceReceipt>;
  wait(generationId: string, options?: { pollIntervalMs?: number; timeoutMs?: number; signal?: AbortSignal; waitForAudio?: boolean; onProgress?: (generation: Generation) => void | Promise<void> }): Promise<Generation>;
}

export interface ReferenceUploadMetadata {
  generation_id: string;
  filename: string;
  byte_size: number;
  duration_seconds: number;
  content_type: string;
  content_sha256: string;
  user_owns_audio: true;
}
export type ReferenceStatus = "upload_pending" | "upload_processing" | "uploaded" | "analyzing" | "ready" | "failed" | "expired" | "aborted" | "archived";
export interface ReferenceReceipt {
  schema_version: "reference_response_v1";
  object: "music_reference";
  reference_id: string;
  generation_id: string;
  filename: string;
  content_sha256: string;
  byte_size: number;
  duration_seconds: number;
  status: ReferenceStatus;
  guidance_available: boolean;
  status_url: string;
  error: { code: string; message: string } | null;
  upload?: { method: "PUT"; url: string; expires_at: string; content_type: string; max_bytes: number } | null;
}
