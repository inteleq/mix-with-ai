# Public API integration

Base origin: `https://mixwithai.com`. Authenticate from your server with `Authorization: Bearer <your MWA key>`. Obtain access at https://mixwithai.com/settings/api. Generation requires approved access, the appropriate scopes, and API credits.

## Submit, poll, play

1. `POST /api/v1/generations` with an `Idempotency-Key`, `Content-Type: application/json`, and a supported request. The starter SDK builds this body for you.
2. Read `generation_id` from the accepted response. Acceptance means queued, not completed.
3. `GET /api/v1/generations/{generation_id}` until the job and audio export settle.
4. When `audio_export.status` is `ready`, use its `download_url`. A saved project can be ready before audio.
5. Read the ready `project_json` artifact from `artifact_manifest.artifacts` if you need the project download.

```json
{
  "schema_version": "music_generation_request_v1",
  "model": "mwa-edm-v1",
  "prompt": "An instrumental deep house track with warm chords and a relaxed breakdown",
  "genre": "deep_house",
  "title": "Golden hour",
  "duration_seconds": 180,
  "bpm": 128,
  "outputs": {
    "project_json": true,
    "preview_audio": true,
    "master_audio": true,
    "stems": "none",
    "midi": false,
    "presets": false
  }
}
```

The current starter profile is 180 seconds at 128 BPM. Prompts are limited to 1500 UTF-8 bytes and titles to 120 characters. Available genres are exported as `GENRES` from the SDK. Separate MIDI, stems, and preset outputs are outside this starter's supported profile.

## Statuses and delivery

Job statuses: `queued`, `in_progress`, `completed`, `completed_with_errors`, `failed`, `cancelled`. `progress` is from 0 to 1. Stage names describe the current work and should be displayed without assuming fixed timings.

Audio delivery has its own status: `unavailable`, `processing`, `ready`, `failed`, or `expired`. `completed_with_errors` may still contain useful output. Inspect artifact statuses individually.

`POST /api/v1/generations/{id}/cancel` requests cancellation. It may be cooperative rather than immediate.

If `audio_export.can_retry` is true, `POST /api/v1/generations/{id}/retry-export` with a new idempotency key requests a retry of audio export. This operation can consume remaining API credit; it does not request a new musical variation. The SDK follows the retry acknowledgement with a fresh status read rather than assuming the acknowledgement is a generation status.

## Variations and remixes

Submit a new generation request with:

```json
{
  "revision": {
    "parent_generation_id": "the-generation-UUID-you-received",
    "kind": "variation"
  }
}
```

Include the normal prompt, genre, and output fields. `kind` may be `variation` or `remix`. Use a new idempotency key. The parent must belong to your authenticated API account. These are new paid operations, not local audio effects.

## Downloads and Studio

Signed downloads expire. Fetch status again for a fresh link while the artifact is retained. The current API guide specifies a 24-hour download retention window; prefer the returned expiry fields over assumptions. Save outputs you intend to keep. A browser may open a signed audio link in a media tab; use its save/download control if needed.

When `studio_project` is present, open the exact saved version at `https://mixwithai.com/chat/{chat_id}/version/{playlist_id}`. MWA still requires the appropriate signed-in account. A project JSON download is the API's project representation; this starter does not claim it is an Ableton project file.

## Recoverable errors

| Response | Suggested action |
| --- | --- |
| 401 / 403 | Check key, scopes, and access approval. |
| 402 | Check the API credit balance. |
| 404 | Check endpoint availability and generation ownership. |
| 409 | Check idempotency conflicts or operation eligibility. |
| 429 | Respect `Retry-After` before trying again. |
| 5xx / network failure | A submission may have been accepted. Reuse the original request and key. |

Use `generations:create` and `generations:read` scopes; cancellation needs `generations:cancel`. API rollout and account availability may change independently of this starter. Check the account's API console before advertising features in a live product.

## Reference guidance

The API and SDK support `referenceGuidance: { mode: "auto" }` or `{ mode: "off" }`. Auto requests automatic guidance; off disables automatic discovery without removing existing project attachments. Omitting the field preserves the server default. This is guidance, not a guarantee of similarity to a specific song. Do not put uploaded audio, URLs, reference IDs or analysis evidence inside referenceGuidance. The separate private upload workflow is described below.

The full developer documentation is at https://mixwithai.com/docs/quickstart, with API and SDK references, an integration guide, Markdown versions, `/llms.txt`, `/llms-full.txt` and the supported EDM-profile `/docs/openapi.json`.

## Private reference upload workflow

Deployment enablement is required. `POST /api/v1/references` prepares or recovers an owned-file upload for a completed generation with a saved Studio version, using a saved Idempotency-Key and exact file metadata. Transfer bytes to its signed PUT URL without the MWA key. `POST /api/v1/references/{id}/complete` verifies the transfer and attaches existing analysis. `GET /api/v1/references/{id}` reports upload state and guidance availability.

The SDK exposes uploadReference, prepareReferenceUpload, getReference, completeReferenceUpload, waitForReference and removeReference. Use only ready references with guidance_available=true in an owned variation/remix in the same project, binding reference_id and content_sha256. The reference supplies whole-track arrangement guidance; output remains the supported EDM profile. Passage editing and internal analysis are not exposed by this contract.

Supported source size: 256 bytes to 50 MiB, declared duration up to one hour, owned WAV/AIFF/FLAC/MP3/M4A/AAC/OGG/OPUS. One active arrangement reference per project. `DELETE /api/v1/references/{id}` removes its attachment or aborts an unfinished upload; retained source audio is not deleted. Read the full contract at https://mixwithai.com/docs/references.

| Reference operation | Required scope | Recovery |
| --- | --- | --- |
| `POST /api/v1/references` | `generations:create` | Reuse the exact metadata and original upload key. |
| `POST /api/v1/references/{id}/complete` | `generations:create` | No body; replay the same ID to recover verification/analysis registration. |
| `GET /api/v1/references/{id}` | `generations:read` | Poll; local timeout does not stop remote analysis. |
| `DELETE /api/v1/references/{id}` | `generations:cancel` | Abort unfinished upload or archive the attachment; does not cancel music generation. |

Preparation metadata: `generation_id`, `filename` (basename), `byte_size`, `duration_seconds`, `content_type` (`audio/*` or `application/octet-stream`), `content_sha256` (64 lowercase hex characters) and `user_owns_audio: true`. Save the exact file, metadata, key and returned ID privately. Arbitrary audio URL imports are unsupported.

`upload_pending` needs a transfer; `upload_processing` needs polling; `uploaded` can recover analysis registration with complete; `analyzing` needs polling. `ready` also requires `guidance_available=true`. Failed, expired, aborted and archived receipts are not a promise of usable guidance. A selected unavailable reference fails instead of producing an unguided replacement. Guided revisions are new paid generation requests and need their own saved key.

For code, options and all helper methods, read [the SDK README](../packages/sdk/README.md). The starter UI demonstrates generation and A/B revisions; the private reference workflow is available through the SDK rather than a starter file-upload screen.

## Hosted API and SDK security boundary

The SDK distributes an independent HTTP client and public types. Its five-file package does not include private application code, the generation engine, reference analyzer, model weights, catalog or server credentials. It has no runtime dependencies or install hooks. Computation stays hosted in MWA.

Your UI calls your authenticated application server, which calls MWA's public API. The key is sent only to the configured HTTPS API origin; redirects are disabled. Reference bytes use the signed HTTPS storage URL returned by MWA without the key. Fetch audio/project downloads separately without credentials. Custom baseUrl/fetch are trusted server configuration and must not be supplied by an end user.

MWA authorizes the API account's resources. Shared-key integrations must authenticate their users, authorize each receipt/reference/download and apply quotas. Keep files, signed URLs and secrets private. See [SECURITY.md](../SECURITY.md) for release checks and integration responsibilities.

## Ableton context and editable project drafts

The [project workspace example](ableton-projects.md) optionally reads Live through
an isolated upstream adapter, edits a local draft and previews selected context.
Its local `/api/project/*` routes do not belong to the hosted MWA API. The current
handoff submits only a reviewed descriptive prompt through `POST /api/v1/generations`
after explicit approval; it does not upload a structured project, edit Live or
materialize an Ableton project in MWA Studio. New generation remains 180 seconds
at 128 BPM. Actual owned generation projects can be opened and edited in MWA
Studio using their returned project links. Full project-context upload, private
Studio materialization and reviewed write-back are documented next phases.

An optional [reviewed audio import](ableton-audio-import.md) can now place a ready
full-track result into a chosen empty audio track through local AbletonJS. Its
local routes use fresh owned generation delivery status; they do not introduce a
hosted Ableton-control API, apply project drafts or submit another generation.
