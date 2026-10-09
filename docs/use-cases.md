# MWA use cases and runnable examples

MWA REST API base: https://mixwithai.com/api/v1. Approved access, required scopes and prepaid API credits are necessary. Examples are illustrative; no successful live generation is asserted by this documentation. Keep all keys on your server.

## Choose a workflow

Six public integration recipes from the standalone mwa-music-starter repository. Each includes a product idea, methods, scopes, code and limits. The SDK connects your server to hosted MWA generation and analysis; private application implementation is not distributed.

- [Prompt-to-music studio](https://mixwithai.com/docs/use-cases#music-studio): Turn a musical brief into a playable electronic track with progress and saved versions. (Generate a track)
- [AI mix and master workflow](https://mixwithai.com/docs/use-cases#mix-master): Explore a clearer production direction on an MWA-generated track, then audition its exported audio. (Generated-track revision)
- [Explore a sound’s character](https://mixwithai.com/docs/use-cases#sound-character): Describe the qualities of a bass, lead or texture and explore them in a new full track. (Describe a new direction)
- [Reference-guided variation](https://mixwithai.com/docs/use-cases#reference-guided): Use audio you own as arrangement and energy guidance for a saved project’s next version. (Reference-upload beta)
- [Soundtracks for creators](https://mixwithai.com/docs/use-cases#soundtrack): Build an audition workflow for a video, game scene or creative installation. (Scene-to-music brief)
- [A/B remix lab](https://mixwithai.com/docs/use-cases#ab-remix): Keep an original track and audition an intentional remix alongside it. (Compare saved versions)

## Run the source examples

Run commands from the starter root with Node.js 22.16+. Use an approved server key in a private .env with MWA_API_KEY. The SDK is included locally; no npm publication is assumed. Prepare commands write private request files and saved UUID keys without an API request. Review the input before intentionally submitting; generation uses API credits. Repeating an unchanged request resumes the same job; changing a submitted request conflicts with its receipt.

For revisions set PARENT_GENERATION_ID to your owned completed generation UUID. References also need the actual REFERENCE_DURATION_SECONDS, an owned audio file and beta deployment enablement. Keep .mwa-examples/ and source audio private. Local source files: examples/prepare-use-case.mjs, examples/generate.mjs, examples/upload-reference.mjs, examples/download-audio.mjs, examples/use-cases/catalog.mjs and examples/use-cases/README.md.

Set GENERATION_ID from your saved generation receipt, then download ready audio:


```sh
node --env-file=.env examples/download-audio.mjs "$GENERATION_ID" .mwa-examples/track.mp3
```


The download helper reads fresh delivery, never forwards the MWA key to storage, disables redirects, verifies available size/checksum metadata, bounds its local download to 64 MiB and never overwrites an output. No new music generation occurs during download.

## Application recipes

### Prompt-to-music studio — music-studio

Generate a track. Turn a musical brief into a playable electronic track with progress and saved versions.

Build: A prompt editor, genre selector, progress timeline and private output library.

Methods: generate(), wait(), get(). Required scopes: generations:create, generations:read.

1. Save the musical brief and a request key.
2. Submit once and persist the generation ID.
3. Follow job and audio status, then play or download the ready output.

Supported scope: The supported profile creates a 180-second electronic track at 128 BPM; it does not support arbitrary durations or streaming generation.

Repository commands:


```sh
node examples/prepare-use-case.mjs music-studio
# Review the saved input. The next command intentionally uses API credits.
node --env-file=.env examples/generate.mjs .mwa-examples/request-music-studio.json
```


SDK excerpt: mwa is your server client, ownedParentId is an owned saved parent when needed, reference is a ready qualified receipt when needed. Persist the exact input and savedRequestKey before submission.


```js
// mwa is your server-side MwaClient; never send its key to the browser.
const input = {
  "prompt": "Warm instrumental deep house with soft chords, a rolling bass, crisp drums and a spacious breakdown. No vocals.",
  "genre": "deep_house",
  "title": "Golden hour"
};
// Save this exact input and savedRequestKey before the intentional paid request.
const accepted = await mwa.generate(input, { idempotencyKey: savedRequestKey });
// Persist accepted.generation_id with the request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Audio is unavailable; inspect this generation");
}
// Fetch its fresh signed audio URL separately, without the MWA key.
```


### AI mix and master workflow — mix-master

Generated-track revision. Explore a clearer production direction on an MWA-generated track, then audition its exported audio.

Build: A production brief editor with before/after listening and notes about balance, low end and space.

Methods: generate(), wait(), get(), retryExport(). Required scopes: generations:create, generations:read.

1. Choose an owned completed generation and describe the production changes.
2. Save a new revision key and request a variation.
3. Compare the two ready audio exports. Retry an export only if can_retry is true.

Supported scope: This is a new paid musical revision with hosted audio export. The public API has no standalone mix/master endpoint for arbitrary songs or uploaded stems, no fixed-mix preservation, and no LUFS or mastering controls. Export retry is recovery, not a mastering effect.

Repository commands:


```sh
node examples/prepare-use-case.mjs mix-master --parent "$PARENT_GENERATION_ID"
# Review the saved input. The next command intentionally uses API credits.
node --env-file=.env examples/generate.mjs .mwa-examples/request-mix-master.json
```


SDK excerpt: mwa is your server client, ownedParentId is an owned saved parent when needed, reference is a ready qualified receipt when needed. Persist the exact input and savedRequestKey before submission.


```js
// mwa is your server-side MwaClient; never send its key to the browser.
const input = {
  "prompt": "Keep the deep house mood. Aim for a clearer balance: a focused bass, a punchy kick, less crowded low mids, restrained reverb and crisp percussion. Instrumental.",
  "genre": "deep_house",
  "title": "Golden hour — production variation"
};
input.revision = { parent_generation_id: ownedParentId, kind: "variation" };
// Save this exact input and savedRequestKey before the intentional paid request.
const accepted = await mwa.generate(input, { idempotencyKey: savedRequestKey });
// Persist accepted.generation_id with the request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Audio is unavailable; inspect this generation");
}
// Fetch its fresh signed audio URL separately, without the MWA key.
```


### Explore a sound’s character — sound-character

Describe a new direction. Describe the qualities of a bass, lead or texture and explore them in a new full track.

Build: A sound-description notebook that turns terms such as warm, plucky or metallic into track briefs.

Methods: generate(), wait(), get(). Required scopes: generations:create, generations:read.

1. Describe timbre, envelope, musical role and arrangement in ordinary language.
2. Save the prompt and request key, then generate a track.
3. Audition the result and request intentional revisions to explore another direction.

Supported scope: Describing a sound is creative direction, not exact recreation. The API returns a full track; it has no isolated sound-cloning, sample-extraction or synthesizer-preset endpoint. Uploaded references provide arrangement/energy guidance, not timbre matching.

Repository commands:


```sh
node examples/prepare-use-case.mjs sound-character
# Review the saved input. The next command intentionally uses API credits.
node --env-file=.env examples/generate.mjs .mwa-examples/request-sound-character.json
```


SDK excerpt: mwa is your server client, ownedParentId is an owned saved parent when needed, reference is a ready qualified receipt when needed. Persist the exact input and savedRequestKey before submission.


```js
// mwa is your server-side MwaClient; never send its key to the browser.
const input = {
  "prompt": "Instrumental bass house with a warm rounded plucky bass, a short attack, a dry rhythmic groove and airy metallic accents. Leave space for the bass motif in the breakdown.",
  "genre": "bass_house",
  "title": "Pluck study"
};
// Save this exact input and savedRequestKey before the intentional paid request.
const accepted = await mwa.generate(input, { idempotencyKey: savedRequestKey });
// Persist accepted.generation_id with the request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Audio is unavailable; inspect this generation");
}
// Fetch its fresh signed audio URL separately, without the MWA key.
```


### Reference-guided variation — reference-guided

Reference-upload beta. Use audio you own as arrangement and energy guidance for a saved project’s next version.

Build: A private reference brief with upload progress, analysis readiness and a guided revision action.

Methods: uploadReference(), waitForReference(), generate(), wait(). Required scopes: generations:create, generations:read.

1. Prepare a receipt for an owned file and completed parent generation; upload with the saved key.
2. Wait for ready and guidance_available=true. Save the reference identity and source hash.
3. Submit a paid variation in the same project using that reference and a new revision key.

Supported scope: Requires reference-upload deployment enablement, an owned completed saved generation and qualified guidance. One active whole-track arrangement reference per project. No exact recording recreation or passage replacement.

Repository commands:


```sh
node examples/upload-reference.mjs prepare "$PARENT_GENERATION_ID" ./reference.wav "$REFERENCE_DURATION_SECONDS" --owns-audio
node --env-file=.env examples/upload-reference.mjs run .mwa-examples/reference-upload.json
node examples/prepare-use-case.mjs reference-guided --parent "$PARENT_GENERATION_ID" --reference-receipt .mwa-examples/reference-upload.json.receipt.json
# Review the saved input. The next command intentionally uses API credits.
node --env-file=.env examples/generate.mjs .mwa-examples/request-reference-guided.json
```


SDK excerpt: mwa is your server client, ownedParentId is an owned saved parent when needed, reference is a ready qualified receipt when needed. Persist the exact input and savedRequestKey before submission.


```js
// mwa is your server-side MwaClient; never send its key to the browser.
const input = {
  "prompt": "Keep the deep house mood; use my reference for arrangement and energy. Make the breakdown spacious and build toward a confident final section. Instrumental.",
  "genre": "deep_house",
  "title": "Reference direction"
};
input.revision = { parent_generation_id: ownedParentId, kind: "variation" };
// reference is your saved upload receipt after waitForReference().
if (reference.status !== "ready" || !reference.guidance_available) {
  throw new Error("Reference guidance is unavailable");
}
input.reference = { reference_id: reference.reference_id, content_sha256: reference.content_sha256 };
input.referenceGuidance = { mode: "auto" };
// Save this exact input and savedRequestKey before the intentional paid request.
const accepted = await mwa.generate(input, { idempotencyKey: savedRequestKey });
// Persist accepted.generation_id with the request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Audio is unavailable; inspect this generation");
}
// Fetch its fresh signed audio URL separately, without the MWA key.
```


### Soundtracks for creators — soundtrack

Scene-to-music brief. Build an audition workflow for a video, game scene or creative installation.

Build: A scene brief, mood notes and a player beside the creator’s own visual preview.

Methods: generate(), wait(), get(). Required scopes: generations:create, generations:read.

1. Translate the scene into mood, instrumentation and arrangement notes.
2. Generate a supported electronic track with a saved request key.
3. Audition against the scene and handle trimming/synchronization in your own editor.

Supported scope: Output remains 180 seconds and 128 BPM. Exact picture sync, arbitrary cue lengths, adaptive game audio and stem delivery are outside this API profile. Review applicable output terms for your distribution.

Repository commands:


```sh
node examples/prepare-use-case.mjs soundtrack
# Review the saved input. The next command intentionally uses API credits.
node --env-file=.env examples/generate.mjs .mwa-examples/request-soundtrack.json
```


SDK excerpt: mwa is your server client, ownedParentId is an owned saved parent when needed, reference is a ready qualified receipt when needed. Persist the exact input and savedRequestKey before submission.


```js
// mwa is your server-side MwaClient; never send its key to the browser.
const input = {
  "prompt": "Instrumental melodic house for a nighttime city journey: restrained opening, warm evolving chords, steady movement and an uplifting final section. No vocals.",
  "genre": "melodic_house",
  "title": "Night journey"
};
// Save this exact input and savedRequestKey before the intentional paid request.
const accepted = await mwa.generate(input, { idempotencyKey: savedRequestKey });
// Persist accepted.generation_id with the request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Audio is unavailable; inspect this generation");
}
// Fetch its fresh signed audio URL separately, without the MWA key.
```


### A/B remix lab — ab-remix

Compare saved versions. Keep an original track and audition an intentional remix alongside it.

Build: Two labeled versions, a single audition player, prompt comparison and private favorites.

Methods: get(), generate(), wait(). Required scopes: generations:create, generations:read.

1. Read the owned original and keep its generation ID.
2. Save a new remix input/key and submit against that parent.
3. Read fresh delivery for both versions and use the starter’s A/B room as a UI example.

Supported scope: A remix is a new paid generation, not a deterministic audio edit. Wait for both audio exports and keep signed URLs private; the starter A/B room is a UI example, not another API endpoint.

Repository commands:


```sh
node examples/prepare-use-case.mjs ab-remix --parent "$PARENT_GENERATION_ID"
# Review the saved input. The next command intentionally uses API credits.
node --env-file=.env examples/generate.mjs .mwa-examples/request-ab-remix.json
```


SDK excerpt: mwa is your server client, ownedParentId is an owned saved parent when needed, reference is a ready qualified receipt when needed. Persist the exact input and savedRequestKey before submission.


```js
// mwa is your server-side MwaClient; never send its key to the browser.
const input = {
  "prompt": "An instrumental deep house remix with a more energetic groove, syncopated percussion, spacious chords and a longer-feeling breakdown. Keep the late-night mood.",
  "genre": "deep_house",
  "title": "After hours — remix"
};
input.revision = { parent_generation_id: ownedParentId, kind: "remix" };
// Save this exact input and savedRequestKey before the intentional paid request.
const accepted = await mwa.generate(input, { idempotencyKey: savedRequestKey });
// Persist accepted.generation_id with the request receipt.
const track = await mwa.wait(accepted.generation_id);
if (!["completed", "completed_with_errors"].includes(track.status) ||
    track.audio_export?.status !== "ready") {
  throw new Error("Audio is unavailable; inspect this generation");
}
// Fetch its fresh signed audio URL separately, without the MWA key.
```



## Capability boundaries

- Mix/master: production-directed revisions and hosted export of MWA-generated tracks. No standalone arbitrary-song or uploaded-stem mastering, fixed-mix preservation, LUFS or processor controls. retryExport recovers an eligible export; it is not a mastering effect.
- Recreate a sound: describe its character in a new full-track prompt. No exact cloning, isolated sample extraction, synthesizer preset matching or timbre-matching API.
- References: owned private source audio with qualified arrangement/energy guidance on a saved-project revision; not exact recreation or passage replacement.
- Soundtracks: supported 180-second, 128-BPM tracks; implement trimming and picture sync in your own application and review output terms.

All generations/revisions are intentional paid requests. Offline examples do not establish live service readiness or musical quality. Published audio needs approval for that use. See https://mixwithai.com/docs/api, https://mixwithai.com/docs/sdk#security and https://mixwithai.com/docs/references.
