const terminal = new Set(["completed", "completed_with_errors", "failed", "cancelled"]);

export function isGenerationBusy(job) {
  if (job.status === "cancelled") return false;
  return !terminal.has(job.status) || job.audio?.status === "processing";
}

export function hasPlayableAudio(job) {
  return job.audio?.status === "ready" && Boolean(job.audio.url);
}
