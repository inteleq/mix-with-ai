# Bring a session to MWA

An original public example for viewing an Ableton snapshot, editing a local
project draft and preparing reviewed musical context for the MWA API. It contains
no private MWA bridge, app, project mapper, analysis or orchestration imports.

## Availability and the exact boundary

| Action | This increment |
| --- | --- |
| View the synthetic project and edit its title, tempo, track labels, selected tracks, mixer draft values and clip timing | Available locally; does not produce or alter audio |
| Import/export this example's public draft JSON | Available; explicit allowlist projection and bounded validation |
| Capture a current Live arrangement snapshot | Optional upstream AbletonJS reader; fixture tested, real Live acceptance still required |
| View a ready MWA generation | Full-track audio draft only; not its private multitrack project |
| Edit that generation's actual MWA project | Open the server-derived owned project link in MWA Studio; normal app sign-in applies |
| Prepare selected context | Local starter routes only; no hosted API call |
| Generate from the reviewed descriptive summary | Existing MWA generation API through the unchanged SDK, after an explicit playground submission |
| Import one ready MWA audio result into an empty Live audio track | Optional reviewed local adapter; fixture tested, real Live acceptance required; [setup](ableton-audio-import.md) |
| Import an Ableton project into MWA Studio using an API key | Next API phase; not implemented or advertised as available |
| Apply draft edits back to Ableton or the MWA source project | Not implemented; requires a separately authorized, reviewed execution path |

The existing public generation profile creates a **new 180-second electronic
track at 128 BPM**. Source tempo and arrangement are descriptive context, not
instructions to reproduce timings, preserve mixer settings or edit the source.
Project metadata contains no audio. It cannot support claims of listening,
mix analysis, sound recreation, missing-media recovery or faithful round-trip.

## Try the editor without installing anything

Use Node.js 22.16 or newer:

```sh
npm start
```

Open `http://127.0.0.1:3008/project`. The original three-track demo is clearly
labeled. Edit the draft, choose included tracks, and select **Review cleaned
context**. Review the context and exact generation prompt. **Continue to MWA
playground** only prefills the prompt; it does not submit or spend credits.
Choose a supported genre and explicitly generate. Demo mode remains a simulation.

Drafts live in page memory. Export public draft JSON to keep one. The server keeps
at most ten handoff prompts per local session, in memory, for the normal 24-hour
session window. Restarting the server resets them. Handoffs never contain an API
key, signed download URL, full context or full source project. Generated jobs remain local-
session-owned as before. Avoid shared computers; exported files can contain your
chosen project labels and timings.

## Optional read-only Ableton capture

The adapter uses **upstream `ableton-js@3.7.3`**, isolated from the dependency-free
MWA SDK and normal starter runtime. Its MIT license and notices remain in the
installed dependency. It is not MWA's private Remote Script or desktop bridge.

```sh
npm run ableton:setup
npm run ableton
```

`ableton:setup` installs the isolated optional dependency with install hooks
disabled. It does not install a script into Live or launch Live.

Install the **matching installed package's** `midi-script` directory from
`integrations/ableton/node_modules/ableton-js/midi-script` into the active Ableton
User Library's `Remote Scripts/AbletonJS` directory. Follow the
[upstream instructions](https://github.com/leolabs/ableton-js) for activation:
restart Live and select AbletonJS as a Control Surface, with Input/Output None.
Use the script shipped with 3.7.3; current upstream main may use another protocol.
Do not use MWA's `MIXWITHAI` script or copy private overlays into this repository.
Do not install into Live's application bundle.

Close MWA Desktop and other clients using the upstream port-file/script protocol
before capturing. This older upstream transport is not qualified for concurrent
connectors. Keep the Live Set idle and do not switch Sets during capture. Reader
coexistence, Live/OS compatibility and real-machine readback are release gates.

Open `/project`, then explicitly choose **Read Ableton snapshot**. Starting the
server does not read Live, launch a browser, upload a snapshot, start observers or
edit a Set. Capture connects temporarily, makes bounded `get()` calls, and closes
the client on success, failure or timeout. Only a loopback-bound starter without
`PUBLIC_ORIGIN` can enable it. Do not expose upstream ports to the LAN or internet.

Capture reads tempo, ordinary/group/return/master tracks, supported volume/pan,
mute state, top-level device **labels** and arrangement clip labels/start/end
timings. It does not read sample file paths, audio bytes, presets, device parameter
trees, MIDI note content, Session clips, routing or automation. IDs are local draft
handles, not authoritative Live identifiers. Optional unavailable reads are
reported. Reads are observational, not an atomic synchronization baseline.
Limits: 128 total tracks, 32 device labels per track, 1,024 clips, 20 seconds.
Oversized captures fail rather than silently claiming a complete project.

## Cleaning and sending context

`public/project-context.mjs` is a new, small public format. `cleanProject()` builds
a fresh allowlisted projection; it never spreads or uploads unknown source
objects. It validates numbers, bounds collections, discards extra fields and
replaces recognizable path/credential/URL labels with generic labels. This is
not a general-purpose confidential-text detector: review free text yourself.

`selectedContext()` includes only selected tracks and renumbers their draft
handles. Project title, track/clip labels and device labels are omitted by
default. Labels can be explicitly included in the context preview; the current
generation summary includes at most eight selected track names and no device
or clip labels. No raw project JSON is uploaded to hosted MWA in this increment.

Local routes are same-origin, cookie-session and CSRF protected:

| Local starter route | Behavior |
| --- | --- |
| `POST /api/project/capture` | Explicit optional Live read; no hosted request |
| `POST /api/project/clean` | Validate and return only the public draft projection |
| `POST /api/project/handoff` | Prepare selected context and a bounded generation prompt; no hosted request |
| `GET /api/project/handoff/{id}` | Read only this local session's prepared prompt |

These are **not** hosted `/api/v1` endpoints. MWA API keys stay on the starter
server and are sent only through the existing client to its configured trusted
MWA origin. The optional reader never receives the key.

For integration code:

```js
import { cleanProject, buildContextPrompt } from "../public/project-context.mjs";
import { MwaClient } from "../packages/sdk/index.js";

const draft = cleanProject(publicDraft);
const { context, prompt } = buildContextPrompt(draft, {
  includeNames: false,
  intent: "Create a new deep house track inspired by the arrangement's energy.",
});
// Display context and prompt; obtain explicit user approval before submission.
const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });
const result = await mwa.generate({ prompt, genre: "deep_house" }, {
  idempotencyKey: savedRequestKey,
});
```

Save the input and request key before submission, as in the existing generation
examples. This code generates new music; it does not import `context` as a project.

## Surgical next implementation phases

1. **Current public increment:** original editable draft UI, selected context,
   allowlist cleaner, optional upstream read-only adapter, reviewed summary handoff.
   Keep the five-file SDK's transport and private-app boundary unchanged.
2. **Hosted project-context API:** design a versioned public request/response
   contract and dedicated project-context permissions. Authenticate API keys with
   the existing machinery; derive ownership from the key, never caller `user_id`.
   Validate again server-side, enforce limits, durable idempotency, quotas, retention
   and per-user read/delete access. Return an owned context/project receipt and
   explicit materialization coverage. Proposed SDK methods and routes are not
   available until implemented. Any schema changes need additive migrations and
   the separate production checkpoint. No direct key access to private app routes.
3. **MWA Studio continuation:** privately reuse the existing snapshot review,
   mapping and immutable-import kernels after qualification. Treat an independent
   public reader's payload as untrusted context, not a signed device proof. Do not
   bypass existing binding/ownership checks. Require user review before creating
   an editable MWA version; preserve unsupported/unknown material rather than
   claiming native plugin sound parity. Upload audio separately, with ownership
   approval, where actual sound analysis or media materialization is required.
4. **Reviewed Ableton project write-back:** the public example now has a separate
   opt-in full-audio placement path, not project/draft synchronization. For full
   project changes, use the private installed MWA Desktop,
   user-approved app/device/Set permissions, the existing command journal and
   single execution owner. Qualify exact Set/version identity, stale snapshots,
   disconnects, cancellation and ambiguous results. A public snapshot's local
   handles must never become mutation targets. Do not publish private executor,
   planner, bridge overlays or arbitrary code/shell dispatch.

Release evidence: wrong session/CSRF/host rejection, unknown-field stripping,
bounded payloads, selected-track privacy, no requests while editing, no writes
from capture, timeout cleanup, matching Live script and an idle disposable Set.
No real Ableton control, faithful project import or paid API pilot is established
by offline fixtures. Publish a campaign only around verified end-to-end behavior.
