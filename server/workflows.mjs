import { cleanWorkflowTemplate, workflowRequest } from "../public/workflow-templates.mjs";

// Truthful local status: key configuration is not account authentication or a quote.
export function workflowReadiness(config, { audioImportAvailable = false } = {}) {
  const preview = config.mode === "demo";
  return {
    mode: config.mode,
    desktop: { status: "not_connected", download_url: "https://mixwithai.com/download", qualification: "pending" },
    account: { status: "unavailable", message: "Signing into MWA does not sign this public example into your account." },
    api: { status: preview ? "not_required" : "configured_unverified" },
    credits: { status: preview ? "not_required" : "unknown", balance: null, trial_eligibility: "server_only_unavailable" },
    ableton: { status: audioImportAvailable ? "enabled_unverified" : "not_enabled", qualification: "real_live_acceptance_pending" },
    generation: { allowed: preview, cost: preview ? { status: "preview", credits: 0 } : { status: "unavailable", credits: null }, message: preview ? "Local synthesized preview only. No MWA request or credits." : "Guided live runs are blocked until account access and an authoritative price quote are connected. The developer playground is available separately." },
  };
}
export function prepareWorkflow(body, jobs) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["template", "parent_generation_id"].includes(key))) throw new TypeError("Supply a template and, for a variation, an owned parent generation.");
  const template = cleanWorkflowTemplate(body.template);
  const input = workflowRequest(template, body.parent_generation_id);
  if (input.revision) {
    const parent = jobs.get(input.revision.parent_generation_id);
    if (!parent || parent.audioReady !== true || !["completed", "completed_with_errors"].includes(parent.status)) throw new TypeError("Choose a ready original owned by this local session.");
  }
  return { template, input };
}
