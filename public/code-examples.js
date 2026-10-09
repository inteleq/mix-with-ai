const genres = ["house", "tech_house", "melodic_house", "afro_house", "deep_house", "progressive_house", "bass_house", "techno", "trance"];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const shellQuote = text => "'" + text.replaceAll("'", "'\\''") + "'";

/** Builds display-only public examples. It neither reads a key nor submits a job. */
export function buildCodeExamples(input, idempotencyKey) {
  if (!input || typeof input.prompt !== "string" || !input.prompt.trim() || new TextEncoder().encode(input.prompt.trim()).length > 1500) throw new TypeError("Describe your music in 1–1500 UTF-8 bytes to preview the request.");
  if (!genres.includes(input.genre)) throw new TypeError("Choose a supported genre.");
  if (!/^[\x21-\x7E]{8,200}$/.test(idempotencyKey || "")) throw new TypeError("Provide a stable example request key.");
  const clean = { prompt: input.prompt.trim(), genre: input.genre };
  if (input.title !== undefined) {
    if (typeof input.title !== "string" || !input.title.trim() || input.title.trim().length > 120) throw new TypeError("Use a title with at most 120 characters.");
    clean.title = input.title.trim();
  }
  if (input.revision) {
    if (!uuid.test(input.revision.parent_generation_id || "") || !["variation", "remix"].includes(input.revision.kind)) throw new TypeError("Choose a valid parent generation and revision kind.");
    clean.revision = { parent_generation_id: input.revision.parent_generation_id, kind: input.revision.kind };
  }
  const request = {
    schema_version: "music_generation_request_v1", model: "mwa-edm-v1",
    ...clean, duration_seconds: 180, bpm: 128,
    outputs: { project_json: true, preview_audio: true, master_audio: true, stems: "none", midi: false, presets: false },
  };
  const body = JSON.stringify(request, null, 2);
  const js = `import { MwaClient } from ${JSON.stringify("./packages/sdk/index.js")};

const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });
const input = ${JSON.stringify(clean, null, 2)};
// Save the input and key before sending. Reuse both for a retry.
const idempotencyKey = ${JSON.stringify(idempotencyKey)};

const job = await mwa.generate(input, { idempotencyKey });
const track = await mwa.wait(job.generation_id);
if (track.audio_export?.status === "ready") {
  console.log(track.audio_export.download_url);
} else {
  console.log(track.status, track.error?.message);
}`;
  const python = `import json, os, time, urllib.request

origin = "https://mixwithai.com"
payload = json.loads(${JSON.stringify(JSON.stringify(request))})
# Save the payload and key before sending. Reuse both for a retry.
idempotency_key = ${JSON.stringify(idempotencyKey)}

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

opener = urllib.request.build_opener(NoRedirect())

def call(path, payload=None):
    headers = {"Authorization": "Bearer " + os.environ["MWA_API_KEY"]}
    data = None
    if payload is not None:
        headers.update({"Content-Type": "application/json",
                        "Idempotency-Key": idempotency_key})
        data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(origin + path, data=data, headers=headers)
    with opener.open(req, timeout=30) as response:
        return json.load(response)

job = call("/api/v1/generations", payload)
while True:
    track = call("/api/v1/generations/" + job["generation_id"])
    status = track["status"]
    audio = track.get("audio_export") or {}
    if status in ("failed", "cancelled") or (
        status in ("completed", "completed_with_errors")
        and audio.get("status") != "processing"
    ):
        break
    time.sleep(3)
print(audio.get("download_url") if audio.get("status") == "ready" else status)`;
  const curl = `# Run on your server with MWA_API_KEY in the environment.
# Keep this payload and key unchanged when retrying a submission.
curl --request POST \\
  --url https://mixwithai.com/api/v1/generations \\
  --header "Authorization: Bearer $MWA_API_KEY" \\
  --header "Content-Type: application/json" \\
  --header ${shellQuote("Idempotency-Key: " + idempotencyKey)} \\
  --data-binary ${shellQuote(body)}

# Then poll using the generation_id from that response:
# curl --header "Authorization: Bearer $MWA_API_KEY" \\
#   https://mixwithai.com/api/v1/generations/YOUR_GENERATION_ID`;
  return { request, javascript: js, python, curl, json: body };
}
