# Send a ready MWA result to Ableton

This optional public example imports **one ready full-track audio result** into
an existing dedicated empty audio track in Live's Arrangement. It uses original
adapter code and upstream `ableton-js@3.7.3`. No private MWA bridge, Remote Script
overlay, project mapper, prompt chain or execution workflow is included.

It does not apply the project editor's draft, rebuild a multitrack project,
import stems/MIDI/presets, change tempo or replace existing clips. Those require
different public contracts and private, qualified execution paths. The current
MWA generation profile supplies full audio, not those separate exports.

## Enable explicitly

Use the optional package and matching upstream Remote Script setup in the
[project guide](ableton-projects.md). Close MWA Desktop and competing connectors.
Configure live MWA mode using `npm run setup`, with your key on the local server.

```sh
npm run ableton:setup
npm run ableton:import
```

Normal `npm start` has no Live connector. `npm run ableton` enables only reads.
`ableton:import` requires live mode and a loopback-only server without a public
origin. Starting it does not read Live, download audio, place clips, launch Live
or open a browser. The explicit UI actions do that work.

## Review and apply

1. Generate through the starter and wait for ready audio. Open **View audio
   draft** or choose that generation at `/project`. Preview-mode audio cannot
   use this import path. Only generations owned by this local session qualify.
2. Save the intended Live Set. Stop playback and recording. Manually create a
   dedicated audio track with no Arrangement clips, Session clips or devices;
   leave it unfrozen and unarmed. Existing populated tracks cannot be targets.
3. In **Result → Live**, read eligible targets. Choose the exact empty track
   and a zero-based Arrangement beat position (`0` is the beginning).
4. Prepare the preview. The server rechecks Set/track identity, refreshes this
   generation's audio URL and downloads bounded WAV/MP3 bytes **without the MWA
   key or cookies**. Redirects are disabled. It verifies provided artifact metadata,
   computes SHA-256 and caches the file privately. No clip is placed yet.
5. Review the Set, track, position, existing tempo, file size and hash. Explicitly
   confirm, then choose **Apply reviewed audio to Ableton**.
6. The adapter rechecks saved Set identity and the unchanged empty target, verifies
   cached bytes, claims the operation once and invokes one audio-placement method.
   Success requires readback of the same audio file and expected clip start.
7. Use **Collect All and Save** in Live to keep the referenced media with your
   project. Existing Set tempo stays unchanged; Live's own import/warp settings can
   affect playback. This example does not promise native audio/warp parity.

The matching upstream method calls `Track.create_audio_clip`. The official
[Live Object Model](https://docs.cycling74.com/apiref/lom/track/#create_audio_clip)
documents audio insertion at an Arrangement position. Old Live versions may not
support the required method or saved-set identity. The adapter fails closed when
it cannot qualify them. Source/fixture checks are not real Live acceptance.

## Identity, receipts and uncertain outcomes

Saved-set path, master identity, tempo, exact track identity, target labels,
mute/solo and Session slot identities bind the short-lived preview. Native paths
remain on the local server and are not uploaded, shown in API responses or stored
in public receipts. Local draft IDs and track indexes are never mutation targets.
Read checks are not an atomic transaction with Live: keep the Set idle and do not
switch or edit it during preview/apply. Stronger remote control remains the private
MWA Desktop integration's separate qualification work.

There is no automatic track creation, replacement, deletion, undo, recording,
transport change or arbitrary command endpoint. The initial empty-track rule
reduces overwrite/overlap risk. Its observations still need actual Live testing.

The local server allows one connector operation at a time and at most ten import
previews per session. Target lists expire after two minutes; prepared plans after
ten minutes. Apply requests require `confirm: true`. Repeated requests for the
same operation return its recorded state and never repeat a completed/uncertain
dispatch. A private exclusive `.started` file is written before execution.

If acknowledgement is lost, exact readback may establish success. Otherwise the
operation becomes `needs_review`; no deletion, compensation or replay is attempted.
Check its status and inspect Live. The browser stores only the operation UUID so
an interrupted response can be checked. Clearing the notice means you inspected
Live, not that a clip was removed or an operation retried.

Private cache and receipts live under `.mwa-examples/ableton-imports` (ignored and
excluded from releases). Files use exclusive creation, checksums and restrictive
permissions; symlinked storage is rejected. Audio is retained because Live can
reference it. Do not remove it until your Live project has collected its media.
Receipts contain operation/generation IDs, public target labels, audio hash,
placement and outcome, never keys, signed URLs, private app code or native paths.

Restarting the starter resets in-memory ownership/previews. Inspect Live and the
local receipts before preparing a replacement for an uncertain operation. A new
session is not proof that a previous import failed. Runtime files are not a
multi-tenant hosted service or a remote MWA operation journal.

## Local routes and the hosted API

| Local route | Behavior |
| --- | --- |
| `POST /api/ableton/targets` with `{}` | Inspect a saved, stopped Set and eligible empty audio tracks |
| `POST /api/ableton/imports` | Prepare owned audio plus an inspected target; fields: `generation_id`, `track_id`, `position_beats` |
| `GET /api/ableton/imports/{id}` | Read this session's operation status |
| `POST /api/ableton/imports/{id}/apply` with `{"confirm":true}` | Dispatch at most once for that reviewed operation |

These same-origin cookie/CSRF-protected routes are in the local starter, not the
hosted `/api/v1` API. The hosted service is used only to read the generation's fresh
delivery status. The SDK remains five files with generation/reference HTTP methods;
it gains no local filesystem, Ableton or arbitrary-execution methods. A fresh
generation is not submitted during preview/apply.

## Required live acceptance before promotion

Use a disposable saved Set, a known ready MWA result and the matching installed
script. Verify exact placement, decoded audio, media retention, unchanged tempo,
existing music, Session clips and devices. Test wrong/unsaved Set, renamed/deleted/
reordered/recreated target, playback/recording, nonempty/armed/frozen target,
disconnect before/after dispatch, duplicate clicks and server restart. Verify on
each advertised OS/Live version. Native APIs and upstream transport can vary;
no real-machine import was performed by the offline implementation checks.
