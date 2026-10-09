# MWA music client

Ready-made workflow templates and teacher lessons are companion examples in the
[public kit](https://github.com/inteleq/mix-with-ai), documented in `docs/workflows.md`.
They call the same generation/revision
methods; no private Desktop modules or generation logic are added to this SDK.
The guided preview and optional local Ableton adapter are separate from the SDK.

A small, independently written server-side JavaScript client for the public MWA API. Includes TypeScript declarations, uses Node.js 22.16+, and has no runtime dependencies. The client is MIT licensed; hosted music generation needs approved API access and prepaid API credits.

## Install and create music

This `0.1.0-beta.3` candidate is distributed as a tarball and is not published to npm. Download it from the [SDK documentation](https://mixwithai.com/docs/sdk), then install the file:

```sh
npm install ./mixwithai-music-client-0.1.0-beta.3.tgz
```

Use an ESM file on your server. Set `MWA_API_KEY` privately in its environment. The example assumes your application has saved `savedInput` and `savedRequestKey` in durable storage before this intentional paid request:

```js
import { MwaClient } from "@mixwithai/music-client";
const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });

const accepted = await mwa.generate(savedInput, {
  idempotencyKey: savedRequestKey,
});
// Save accepted.generation_id with the same request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Track audio is unavailable; inspect this generation");
}
```

`savedInput` can be `{ prompt: "Warm instrumental deep house with a rolling bass", genre: "deep_house" }`. Use a saved UUID as the request key. Read the [complete quickstart](https://mixwithai.com/docs/quickstart) for a runnable example that persists its receipt and downloads audio without forwarding the key.

## Supported features

| Feature | What you can build |
| --- | --- |
| Original generation | A prompt-to-music interface with status and playback. |
| Variations and remixes | An A/B player or revision workflow using an owned parent generation. |
| Reference guidance | Automatic musical guidance with `referenceGuidance: { mode: "auto" }`; `off` disables automatic discovery. |
| Private reference upload | An owned-audio brief and guided revision in a saved project, when reference-upload beta is enabled. |
| Cancellation and export recovery | Stop an owned job or retry an eligible audio export without creating another song. |
| Typed receipts and polling | Recover interrupted sessions and refresh available delivery links. |

The generation builder supports the MWA EDM profile: 180 seconds, 128 BPM, nine electronic genres, audio and project JSON. Separate stems, MIDI and preset downloads are outside this profile. Generation and reference analysis run in hosted MWA services.

## Methods

| Method | Purpose / required scope |
| --- | --- |
| `generate(input, { idempotencyKey, signal? })` | Original or revision; `generations:create`. |
| `get(id, { signal? })` | Owned status and available refreshed delivery links; `generations:read`. |
| `wait(id, options?)` | Poll generation and audio state; `generations:read`. |
| `cancel(id, { signal? })` | Request cancellation; `generations:cancel`. Work can stop at a later boundary. |
| `retryExport(id, { idempotencyKey, signal? })` | Eligible export retry, then fresh status; create and read scopes. Can use remaining credit. |
| `uploadReference(generationId, audioBlob, options)` | Hash, prepare, transfer and complete an owned reference; `generations:create`. |
| `prepareReferenceUpload(metadata, { idempotencyKey, signal? })` | Prepare/recover a signed transfer; `generations:create`. |
| `getReference(id, { signal? })` | Owned upload and analysis state; `generations:read`. |
| `waitForReference(id, options?)` | Poll analysis separately; `generations:read`. |
| `completeReferenceUpload(id, { signal?, timeoutMs? })` | Verify bytes and recover analysis registration; `generations:create`. |
| `removeReference(id, { signal? })` | Remove an attachment or abort unfinished upload; `generations:cancel`. |
| `createRequest(input)` | Build the supported public JSON body without a network call. |
| `GENRES` / `MwaApiError` / TypeScript types | Supported genres, structured errors, and public requests/receipts. |

`GenerationInput` accepts only `prompt`, `genre`, optional `title`, `revision`, `referenceGuidance` and `reference`. Prompt: 1–1500 UTF-8 bytes after trimming. Title: 1–120 characters. `revision` is `{ parent_generation_id, kind: "variation" | "remix" }`. `reference` is `{ reference_id, content_sha256 }` for a guided revision. Unknown fields are rejected.

`referenceGuidance` accepts only `{ mode: "auto" | "off" }`. Omit it to preserve the API default. Off disables automatic discovery but does not remove existing project attachments. Audio URLs, reference IDs and analysis data do not belong inside this setting.

## Upload owned reference audio

Reference-upload deployment enablement is required; unavailable deployments return `503 reference_uploads_unavailable`. Start with your completed generation and its saved Studio version. Audio must be yours to use: decodable WAV, AIFF/AIF, FLAC, MP3, M4A, AAC, OGG or OPUS, 256 bytes to 50 MiB, duration greater than zero and at most one hour.

Your application supplies the Blob. Save the exact file, metadata and unique upload key first:

```js
const uploaded = await mwa.uploadReference(parentGenerationId, ownedAudioBlob, {
  filename: "reference.wav", // Basename, without path separators.
  durationSeconds: 30,       // File duration; MWA measures audio in analysis.
  userOwnsAudio: true,
  idempotencyKey: savedUploadKey,
});
// Persist uploaded.reference_id with your upload receipt.
const reference = await mwa.waitForReference(uploaded.reference_id);
if (reference.status !== "ready" || !reference.guidance_available) {
  throw new Error("Reference guidance is unavailable");
}
```

The helper computes SHA-256, prepares a signed HTTPS upload, transfers the exact bytes without the MWA Bearer key, and completes verification. Transfers and mutations are not automatically retried. `uploadTimeoutMs` defaults to five minutes; completion has its own five-minute `timeoutMs`. Analysis is asynchronous and needs separate polling.

For a new paid revision, save the following input and a **new** revision request key before submitting:

```js
const input = {
  prompt: "Keep the mood; use my reference for arrangement and energy",
  genre: "deep_house",
  revision: { parent_generation_id: parentGenerationId, kind: "variation" },
  reference: {
    reference_id: reference.reference_id,
    content_sha256: reference.content_sha256,
  },
};
const accepted = await mwa.generate(input, { idempotencyKey: savedRevisionKey });
const revised = await mwa.wait(accepted.generation_id);
// Inspect revised.status and audio_export before playback.
```

The SDK sets `referenceGuidance.mode=auto` for an explicit reference and rejects `off`. Raw REST must supply `auto` explicitly. The reference must be ready, qualified and active in the same owned project as the revision. One active whole-track arrangement reference is supported per project. An unavailable selected reference fails instead of silently generating an unguided replacement. Guidance affects arrangement and energy; it does not guarantee exact recording recreation, melody copying, passage replacement or audio-to-audio conversion.

### Metadata, statuses and recovery

`prepareReferenceUpload` accepts exactly `generation_id`, `filename`, `byte_size`, `duration_seconds`, `content_type`, `content_sha256` and `user_owns_audio: true`. MIME type must be `audio/*` or `application/octet-stream`; SHA-256 is 64 lowercase hex characters for the exact bytes. Use the same metadata and upload key to recover preparation. Changed metadata with the same key conflicts.

| Status | Next step |
| --- | --- |
| `upload_pending` | Transfer the prepared file. Renew an eligible signed authority with the saved metadata/key. |
| `upload_processing` | Finalization is running; poll. |
| `uploaded` | Verified source is retained; `completeReferenceUpload` resumes analysis registration. |
| `analyzing` | Wait for analysis. |
| `ready` | Require `guidance_available === true` before a guided revision. |
| `failed` | Inspect `error`; recover this upload/registration explicitly. |
| `expired`, `aborted`, `archived` | Unavailable for a new guided request. |

Ready replay transfers no bytes and starts no new analysis. `completeReferenceUpload` reuses its reference identity. `removeReference` archives the attachment or aborts an unfinished upload, retaining private source audio. It does not cancel a music generation. Remove the old attachment explicitly before selecting another arrangement reference.

Public receipts contain the reference ID, parent generation ID, file metadata, source hash, status, guidance availability and error. Preparation can include a signed transfer authority or `upload: null`. Internal analysis records are not returned. Full contract: [reference uploads](https://mixwithai.com/docs/references).

## Polling, retries and errors

`wait` and `waitForReference` accept `pollIntervalMs` (3000), `timeoutMs` (15 minutes), `signal` and optional async `onProgress`. Temporary read failures honor `Retry-After`. `waitForReference` returns ready, failed, expired, aborted and archived as data. A local timeout or abort stops waiting and does not cancel remote work.

`wait` also accepts `waitForAudio` (false). Failed and cancelled jobs are terminal data; inspect `status`, `error` and `audio_export`. After an eligible export retry, `wait(id, { waitForAudio: true })` continues polling a processing export even if the original audit status is failed. Inspect final audio state; cancellation remains terminal.

Mutations never automatically retry. After an ambiguous generation submission, reuse the exact input and original request key. A new key intentionally requests new work. Each variation, remix and eligible export retry needs its own saved key. Do not start a new job to recover a slow one.

HTTP failures throw `MwaApiError` with `status`, `code`, optional `requestId`, `retryable` and optional `retryAfterMs`. Network failures use status 0. The default HTTP timeout is 30 seconds, with separate reference transfer/completion limits above.

## SDK security and hosted service boundary

The package contains exactly `index.js`, `index.d.ts`, `package.json`, `README.md` and `LICENSE`. It has no private repository imports, runtime dependencies, install hooks, filesystem access or telemetry. MWA’s generation engine, analysis implementation, model weights, catalog, application source and server credentials are not included. This is a public client for the hosted service.

Authenticated requests use only the documented `/api/v1/generations` and `/api/v1/references` endpoints on `https://mixwithai.com` by default. HTTPS is required and redirects are disabled. Reference bytes go to the signed HTTPS transfer URL returned by MWA **without the MWA key**. The SDK does not fetch audio/project download URLs; your application does so separately without credentials. Keep signed URLs and private source audio out of public logs and share cards.

Keep the key on your server; do not put the SDK in a browser bundle. Browser construction is rejected, but that check does not replace your deployment’s secret handling. `baseUrl` and injected `fetch` are trusted server configuration: a custom origin receives the key, and custom fetch can inspect it. Never accept these options from an end user. `baseUrl` must be a clean HTTPS origin without `/api/v1`, credentials, path, query or fragment; `timeoutMs` must be positive.

MWA enforces API-account ownership. A shared-key integration must authenticate its own users, authorize each receipt/reference/download, enforce quotas and keep durable per-user ownership records. Public types describe the integration contract; they do not grant access to other users’ resources or distribute the service implementation.

Release checks inspect the five-file boundary, private imports and credential patterns. Offline fixtures exercise the extracted package’s public routes and storage credential separation. These checks are scoped evidence, not a guarantee about every integration or a completed live lifecycle validation.

## Documentation and release status

Explore [six use cases and runnable source recipes](https://mixwithai.com/docs/use-cases): music creation, generated-track production revisions, sound-character exploration, private reference-guided variations, creator soundtracks and A/B remixes. The standalone starter contains the examples; they are not bundled into this five-file SDK. Recipes prepare durable requests locally before intentional paid submission and document their public API limits.

Start at [Quickstart](https://mixwithai.com/docs/quickstart), [API](https://mixwithai.com/docs/api) and [SDK](https://mixwithai.com/docs/sdk). AI tools can read [llms.txt](https://mixwithai.com/llms.txt), [llms-full.txt](https://mixwithai.com/llms-full.txt) and [OpenAPI](https://mixwithai.com/docs/openapi.json). All guides also have Markdown representations.

This is an unpublished beta candidate. Package scope ownership, live pilot evidence and registry publication are separate release steps. Offline tests do not establish deployed reference availability, musical quality or production billing.

The standalone starter also includes a public project draft editor and an optional
upstream Ableton reader outside this SDK package. They prepare a reviewed musical
summary for the existing `generate()` method. The SDK has no Ableton connection,
structured project-upload or Live mutation methods. The reader never receives
the MWA key; local edits and context preview do not trigger hosted requests. Full
project import and reviewed project write-back require future public API support.

The standalone starter also offers an explicit local full-audio import adapter
outside this package. It reads owned generation delivery status through `get()`,
downloads WAV/MP3 without forwarding the key, and reviews an empty Live target
before placement. It is not a hosted SDK mutation method or project synchronization.
Normal startup remains read-only; real Live acceptance is still required.
