# Runnable examples

Start with the [six application recipes](use-cases/README.md): music creation, a production-directed mix/master workflow, sound-character exploration, private reference-guided revisions, soundtracks and an A/B remix lab. [Complete guide and SDK excerpts](../docs/use-cases.md).

Use Node.js 22.16+ from the starter root. Preparation is local; actual generation requires your approved server key in private `.env` and uses API credits.

## Prepare, review, generate

```sh
node examples/prepare-use-case.mjs music-studio
# Review .mwa-examples/request-music-studio.json before the paid submission.
node --env-file=.env examples/generate.mjs .mwa-examples/request-music-studio.json
```

The preparation command writes the input and a fresh request key without making an API request. It refuses to overwrite a file. Use `--output` for a separate intentional request.

The runner saves a `.receipt.json` beside the request and verifies its normalized input hash. If interrupted, rerun the unchanged request: it resumes from the receipt or resubmits the same input/key through API idempotency. Never change the input or key to recover a timeout. Keep prompts and IDs private; `.mwa-examples/` is ignored and excluded from release archives.

## Prepare a variation or remix

The generic revision example is also available:

```sh
node examples/revise.mjs YOUR_GENERATION_UUID variation request-variation.json
node --env-file=.env examples/generate.mjs request-variation.json
```

Edit the saved prompt/genre before first submission. The parent must be owned by your API account. Replace `variation` with `remix` for that kind. Each revision is new intentional paid work.

## Reference upload and downloads

`upload-reference.mjs` has separate local `prepare` and live `run` commands. It requires owned audio, saved metadata, a stable upload key, an unchanged source hash and reference-upload beta enablement. `download-audio.mjs` fetches ready audio without forwarding the MWA key to storage. See [recipe commands and limits](use-cases/README.md).

## Integrate elsewhere

For the original editable project draft and optional read-only Live integration,
run the starter and open `/project`. See [Ableton setup, public context format,
API limits and next implementation phases](../docs/ableton-projects.md).

Install the included SDK folder or prepared tarball and import `MwaClient` from `@mixwithai/music-client`. This candidate is not published to npm. Use [API documentation](../docs/api.md), [SDK documentation](../packages/sdk/README.md) and [security boundaries](../SECURITY.md). Keep the SDK and shared key on your server; your product handles user authorization and durable ownership.
