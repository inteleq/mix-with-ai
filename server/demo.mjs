import { randomUUID } from "node:crypto";

/** A clearly labeled UI fixture. Input never goes to a music model in demo mode. */
export class DemoService {
  jobs = new Map();
  constructor({ durationMs = 4200, now = Date.now } = {}) { this.durationMs = durationMs; this.now = now; }
  async generate(input) {
    const id = randomUUID();
    this.jobs.set(id, { input, start: this.now(), cancelled: false });
    return this.get(id);
  }
  async get(id) {
    const job = this.jobs.get(id);
    if (!job) throw new Error("Preview expired.");
    const progress = Math.min(1, (this.now() - job.start) / this.durationMs);
    return {
      generation_id: id,
      status: job.cancelled ? "cancelled" : progress === 1 ? "completed" : "in_progress",
      stage: job.cancelled ? "cancelled" : progress === 1 ? "complete" : "previewing_workflow",
      progress: job.cancelled ? 0 : progress,
      created_at: new Date(job.start).toISOString(),
      audio_export: job.cancelled ? { status: "unavailable", can_retry: false } : progress === 1 ? { status: "ready", can_retry: false, download_url: `/api/demo-audio/${id}` } : { status: "processing", can_retry: false },
      result: { warnings: [] },
      demo: true,
    };
  }
  async cancel(id) { this.jobs.get(id).cancelled = true; return this.get(id); }
}
