# Build on the starter

The extension point is the public API. The interface, local server, and client in this repository can be changed independently of the hosted music service.

Start with the [six runnable application recipes](../examples/use-cases/README.md) and [use-case guide](use-cases.md). They cover music creation, production-directed revisions, sound-character prompts, qualified reference guidance, soundtracks and A/B remixes, with methods, scopes, saved requests, recovery and capability limits. The public API does not provide arbitrary-song/stem mastering or exact sound cloning.

## 1. A music creation app

Start with `public/app.js` and `public/styles.css`. Add your own genres-of-interest UI, prompt presets, onboarding, and listening experience. Keep supported API genre values intact. Send prompts to your server and use `MwaClient.generate` there.

For a public product, add user authentication, a durable mapping from your user to generation IDs, per-user budgets, and a persistent output library. The local starter keeps jobs in memory for one session; it is not a multi-user backend.

The included A/B room is a runnable example you can extend. Add searchable saved tracks or playlists around the audio and project outputs already covered by this integration.

## 2. A soundtrack workflow

Let a creator describe the mood of a video, game scene, or installation. Translate that brief into a prompt, generate a track, and let the creator audition it against their content.

The API profile in this starter generates a three-minute electronic track. Exact picture sync, arbitrary durations, stems, adaptive music, and guaranteed licensing for a particular distribution are not features established by this starter. Implement trimming in your own app and review the applicable service/output terms for the use case.

**Build next:** A/B listening, time markers, project notes, and export to your existing content workflow.

## 3. A version playground

Keep the first generation ID, then submit `revision: { parent_generation_id, kind: "variation" }` or `kind: "remix"`. Save the returned generation as a new version in your own interface. Each submission uses a fresh idempotency key and can consume credits.

The included comparison interface auto-selects ready parent/variation pairs. Extend it with side-by-side prompt comparison, favorites, version notes, or an audition queue. See `examples/revise.mjs` and `docs/comparison.md`.

## Interactive public requests

The code explorer reflects the current generation form and revision choice. `public/code-examples.js` builds JavaScript SDK, Python standard-library, cURL, and JSON examples. It does not read an API key or submit a request. Examples use an environment-variable key placeholder and an example idempotency key that stays stable while switching languages for the same input.

Running a copied example is a new intentional API request and can use credits. The example key is separate from the playground's submission key. Preserve its payload and key for retries rather than treating the snippet as a replay of a previously generated track.

## Public campaign audio

Populate the showcase from approved permanent audio URLs using `docs/showcase.md`. The list is initially empty. The A/B preview fixtures remain separately labeled, and the public showcase does not pull audio or operational data from your account.

## Use a different frontend

The starter frontend is plain HTML, CSS, and JavaScript. It can be replaced with React, Vue, Svelte, a desktop interface, or your own stack. Keep the client in a trusted server process. A mobile app or shipped desktop binary is not a safe place for your organization's shared API secret.

The SDK directory can be installed locally, copied with its license, or published under your own available package name. There are no imports from an MWA application repository.

## Optional campaign instrumentation

The browser dispatches `mwa:starter` events. By default, no analytics are collected or sent anywhere.

```js
window.addEventListener("mwa:starter", ({ detail }) => {
  // Connect your own consent-aware analytics here.
  // detail contains a name, mode, and bounded status flags — no prompt or key.
});
```

Events include `generation_requested`, `generation_request_failed`, `generation_finished`, `audio_played`, `audio_download_clicked`, `code_copied`, `api_access_clicked`, `repository_clicked`, `showcase_prompt_used`, and `comparison_played`. They are UI events, not proof of a new GitHub star, API signup, paid generation, or successful file download. Use authorized server/account data to measure those outcomes separately.

If you want to contribute, add a runnable example with a short README and screenshots made from your own data. Share your project using the repository's showcase issue template.
