# MWA Music Starter campaign kit

## The promise

**Make music. Build something with it.**

A working starting point for music applications powered by the MWA API. The open-source product is this starter and client; MWA is the hosted music service.

Primary audience: developers building music creation tools, creator workflows, audio experiments, and interfaces for comparing generated tracks. The first release targets the supported electronic music profile.

## Launch post

> We built MWA Music Starter: an open-source starting point for your next music app.
>
> It includes a working interface, a JavaScript client with TypeScript types, and examples for generating tracks and exploring variations through the MWA API.
>
> Compare versions in the A/B room and turn your current prompt into JavaScript, Python, or cURL code you can reuse.
>
> Follow the local setup guide, then give a ready track a share card. Cards render on your device and keep preview audio clearly labeled.
>
> Try the interface without an account, then connect your MWA API key to generate real music.
>
> Fork it, change it, and show us what you build. If it is useful, a GitHub star helps other music developers find it.
>
> [Repository link] · [Preview link]

Replace both links with real destinations before posting. Do not imply API generation is free. The no-key mode is a labeled 15-second sample preview.

## Short post

> Your next music app starts here. MWA Music Starter includes a working playground, a typed API client, and runnable examples. Open source, ready to customize. Try the preview, connect your MWA key, and build something. [Repository link]

## Technical community post

> We are sharing the integration layer around the MWA music API: a dependency-free Node server example, plain JavaScript frontend, typed client, and tests for retries, sessions, and API-key handling. The repository includes a preview fixture so you can inspect the experience without an account. We would appreciate feedback on the developer experience and examples you would like next. [Repository link]

Post where self-promotion and project sharing are allowed. Lead with a working example, disclose your connection to MWA, and respond to technical questions. Do not buy stars, send unsolicited bulk messages, or claim results you have not measured.

## A 35-second demo recording

| Time | Screen | Message |
| --- | --- | --- |
| 0–5s | Starter headline and visible mode label | “Your next music app starts here.” |
| 5–12s | Choose a prompt and submit | “A ready-to-customize music workflow.” |
| 12–20s | Status and playback | “Connect MWA for real track generation.” |
| 20–28s | A/B switching and interactive code examples | “Compare versions. Copy the request. Build your own app.” |
| 28–35s | GitHub and API-access actions | “Fork it. Build something. Share it.” |

For preview footage, keep “Preview mode” visible and label the audio “local synthesized preview.” For live footage, use authorized real output, disclose any cuts/time compression, and avoid displaying keys, private prompts, or signed URLs. Avoid claims of instant generation or output types outside the supported API profile.

## Suggested first release

Title: **MWA Music Starter v0.1 — your first track, your next music app**

Description:

> The first MWA Music Starter release includes a music playground, a server-side client with TypeScript definitions, generation/revision examples, and a preview mode that runs without an API key. Real music generation uses your approved MWA API access and credits. Built for developers who want to create their own music experience.

Attach the clean release archive after running the checks. Set the repository's social preview using the original banner in this folder. Add a short recording showing the actual starter. No star count or customer claim is included until real data exists.

## Measure the campaign

| Goal | Useful signal |
| --- | --- |
| Discovery | Repository visitors, traffic sources, and actual stars |
| Developer interest | Template uses, forks, meaningful issues, SDK example use |
| Activation | First successful live generation by a new API account |
| Continued use | Active integrations and repeat API use after 7/30 days |
| Advocacy | Real projects shared by their developers |

Links to MWA include campaign UTM parameters. UTM tags do not automatically create analytics or prove attribution. The starter emits local browser events but sends no analytics. Connect an appropriate measurement system separately; do not collect prompts, keys, or signed URLs as marketing telemetry.

Track-card captions use `utm_source=share_card` and the campaign name from `site.config.json`. The local extension events include `setup_commands_copied`, `share_card_opened`, `share_card_downloaded`, and `share_caption_copied`. Those events carry no title, prompt, generation ID, or audio URL. Connect measurement separately; a download event does not establish that a visitor published the card or that anyone heard a track.

Test one clear claim and demo with a small group of target developers first. Prioritize fixes that reduce time to a first successful integration. GitHub stars are an awareness metric; repeat API usage is the conversion outcome.

## Project-context campaign example

Claim: **Bring a session's context. Build your next music experience with MWA.**

Show `/project`: the original labeled demo, track/clip draft editing, selected
tracks and the exact cleaned context/prompt preview. Continue to the playground
and explicitly generate. For a real ready MWA result, show the source project
link opening MWA Studio, where the actual project can be edited.

Replace the synthetic source with an Ableton capture only after matching-script,
OS/Live and disposable-Set acceptance. The capture is observational and read-only.
Do not describe local draft changes as Live edits, context as audio analysis, or
the current generation handoff as full project import. Its hosted request produces
new 180-second music at 128 BPM, not a faithful reproduction of the source Set.
The private MWA app/bridge/planner remains outside GitHub. Explain the next hosted
project-context/import phase as a roadmap, not an available SDK method.

The optional audio-return example extends the story after real Live acceptance:
ready MWA full-track audio → inspect a saved stopped Set → select an empty audio
track → review file/target/placement → explicitly apply once → verify readback.
Show the confirmation and unchanged existing music. This is full-audio placement,
not multitrack reconstruction or applying the draft's mixer/clip edits. Until the
real-machine gate passes, present this as a fixture-tested beta example.
