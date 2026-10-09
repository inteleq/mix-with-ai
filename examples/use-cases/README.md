# Six music application recipes

Run these from the standalone starter root with Node.js 22.16+. The SDK is included locally; no private application imports or runtime dependencies are needed. The public prompts and recipe descriptions live in `catalog.mjs`. [Full guide and SDK excerpts](../../docs/use-cases.md).

| Recipe | Build | Input / result |
| --- | --- | --- |
| `music-studio` | Prompt-to-music studio | A musical brief → a full electronic track and project delivery. |
| `mix-master` | AI production workflow | An owned generated parent + production brief → a new variation with hosted audio export. |
| `sound-character` | Sound-description notebook | Timbre and musical-role descriptions → a new full track exploring that direction. |
| `reference-guided` | Private reference brief | Owned audio + ready analysis + saved parent → a guided variation. |
| `soundtrack` | Creator soundtrack audition | Scene/mood brief → a supported electronic track to audition in your editor. |
| `ab-remix` | A/B remix lab | Owned parent + remix brief → another saved version for comparison. |

All generation outputs use the supported profile: 180 seconds, 128 BPM, nine electronic genres, audio and project JSON. `mix-master` is a musical revision of an MWA track, not an arbitrary-song/stem mastering service. `sound-character` explores a description, not exact sound cloning, an isolated sample, or a preset. Reference audio guides arrangement and energy, not timbre recreation. Soundtrack trimming, picture sync and playback are your app's responsibilities.

## 1. Prepare a request locally

These commands require no key and make no API request. They save a fresh UUID key with the input, privately, and refuse to overwrite an existing file.

```sh
node examples/prepare-use-case.mjs music-studio
node examples/prepare-use-case.mjs sound-character
node examples/prepare-use-case.mjs soundtrack
```

For revisions set `PARENT_GENERATION_ID` locally to your owned completed generation UUID, then choose one:

```sh
node examples/prepare-use-case.mjs mix-master --parent "$PARENT_GENERATION_ID"
node examples/prepare-use-case.mjs ab-remix --parent "$PARENT_GENERATION_ID"
```

Requests are saved as `.mwa-examples/request-<recipe>.json`. Review and edit the prompt/genre before the first submission. Use `--output .mwa-examples/my-request.json` for a separate intentional request. After submission, keep the input and key unchanged when recovering.

## 2. Submit intentionally

Use your own approved MWA key in a private `.env` containing `MWA_API_KEY`. Required scopes: `generations:create` and `generations:read`. API credits are separate from the MIT client license. The next command is a paid generation request:

```sh
node --env-file=.env examples/generate.mjs .mwa-examples/request-music-studio.json
```

Replace the filename for your selected recipe. The runner saves `.receipt.json` alongside it, checks the exact normalized request hash, and resumes the same generation if rerun. It does not print keys or signed delivery URLs. A failed generation or unavailable export ends with a nonzero exit code; inspect the same job before creating anything new.

The runner creates a receipt after acceptance. If interrupted before writing it, the unchanged request/key recovers submission through API idempotency. Receipts from older runner versions without a request hash are rejected; verify their saved generation directly with the SDK rather than changing a key to force resubmission.

## 3. Download ready audio

Set `GENERATION_ID` from your saved receipt:

```sh
node --env-file=.env examples/download-audio.mjs "$GENERATION_ID" .mwa-examples/track.mp3
```

The helper refreshes status, requires ready audio, downloads the signed HTTPS URL without the MWA key, disables redirects, bounds its example download to 64 MiB, verifies available size/checksum metadata, writes privately, and never overwrites an output. Use an extension appropriate to the returned format. It requests no new music generation. For A/B listening, download both saved versions or extend the starter's existing comparison room.

## Private reference-guided workflow

Requires reference-upload beta deployment enablement and private storage. Start with an owned completed generation and saved Studio version. Provide audio you own: 256 bytes to 50 MiB, duration greater than zero and up to one hour, in WAV, AIFF/AIF, FLAC, MP3, M4A, AAC, OGG or OPUS format.

Set `REFERENCE_DURATION_SECONDS` to the actual duration of `reference.wav`. The explicit `--owns-audio` flag confirms ownership. This preparation hashes the file and saves metadata, a source path and an upload key; it makes no API request:

```sh
node examples/upload-reference.mjs prepare "$PARENT_GENERATION_ID" ./reference.wav "$REFERENCE_DURATION_SECONDS" --owns-audio
```

Review the plan, then intentionally upload and analyze:

```sh
node --env-file=.env examples/upload-reference.mjs run .mwa-examples/reference-upload.json
```

This invokes the reference API and a signed storage transfer, with no MWA key on storage. It requests no music generation. Reuse the same file/plan/key after an interruption; changed source bytes are rejected before a network call. The ready receipt stores only the public reference identity, parent, source hash, status and guidance availability. No signed authority is persisted.

Use the same parent with the ready qualified receipt to prepare a new paid variation:

```sh
node examples/prepare-use-case.mjs reference-guided --parent "$PARENT_GENERATION_ID" --reference-receipt .mwa-examples/reference-upload.json.receipt.json
node --env-file=.env examples/generate.mjs .mwa-examples/request-reference-guided.json
```

One active whole-track arrangement reference per project. Remove its attachment explicitly before choosing another. An unavailable selected reference fails instead of silently generating an unguided replacement. Analysis failure is returned as status data; ready also needs `guidance_available=true`. [Full status/recovery guide](https://mixwithai.com/docs/references).

## Extend the recipe into a product

Authenticate your users on your server; map requests, generations and references to them in durable storage. Enforce ownership, quotas and intentional credit use. The starter's file receipts demonstrate recovery, not a hosted multi-user database. Keep `.env`, `.mwa-examples/`, signed URLs and source audio out of public logs, commits, share cards and fixtures. Only publish approved campaign music.

Offline tests cover preparation, interruption recovery, source identity, guided requests and storage credential separation. They are not live availability, musical-quality or billing evidence. The generated public recipes expose only prompts and integration code; MWA's generation/analysis implementation stays hosted.
