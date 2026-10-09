# Guided music workflows

Open **`/workflows`** on the running local kit or hosted preview. Choose a workflow,
change its name/genre/prompt, hear an example, run a local listening preview,
compare a variation and save preferences. Teachers can share a lesson link or
JSON. Developers can reuse the templates with the public MWA SDK. Templates are
configuration, not MWA's private generation workflows.

## Available workflows

| Workflow | Result | Boundary |
| --- | --- | --- |
| Create an idea | A new generation request with a supported genre and descriptive prompt | Live profile: 180 seconds, 128 BPM, full audio and project JSON. No tempo or short-loop controls. |
| Make a variation | A new request with `revision.kind: variation` and an owned parent UUID | Choose a ready result from this local session. A live revision is another potentially paid request. |
| Bring a result into Ableton | Reviewed placement of existing ready full audio into a dedicated empty audio track | Separate opt-in public adapter. Saved/stopped Set, explicit target inspection, preview and confirmation. Real Live acceptance pending. No multitrack reconstruction or draft write-back. |

The preview costs **zero API credits** and uses the starter's original 15-second
synthesized audio. It does not call MWA, follow the prompt or establish that real
generation works. Approved real examples load from `showcase.json`; until supplied,
cards explicitly identify their synthetic examples.

Setup distinguishes configuration from verification. A key on the local server
is not proof of an active account, API approval, balance or price. Refreshing setup
makes no MWA call and does not inspect or change Live.

**Guided live generation is blocked server-side.** There is no public account
sign-in/balance/price-quote integration in this release. In live developer mode,
**Review in developer playground** transfers preferences within the same local
session, without submitting a request. That playground uses the existing public
generation API and its separate explicit generation button. Developers must check
their API account's pricing/balance. The separate developer route is not a
musician-ready billing or authentication implementation.

Ready live results from this kit can be selected explicitly, played, compared with
their owned parent, opened in MWA Studio or prepared for the existing
[reviewed Ableton adapter](ableton-audio-import.md). Opening the page, loading
preferences, following a lesson or choosing a workflow never dispatches generation
or native writes. Examples use `preload="none"` and do not autoplay.

## Try the first journey

For developers running this source checkout: install Node 22.16+, run `npm start`,
then open `http://127.0.0.1:3008/workflows`. No key is needed for the preview.

1. Choose **Create an idea**. Rename it, choose a genre and describe its character.
2. Acknowledge the preview and choose **Run listening preview**.
3. Listen. Choose **Make a variation**, review the original and run another preview.
4. Switch original/variation at the same listening position.
5. Save preferences on this browser or export the public template JSON.

The public source is **not an installable desktop product**. **Get MWA Desktop**
points to the existing official download page, not a newly built installer.
Installation, sign-in without pasted keys, account API credit access and private
bridge interoperability still require qualification in the private Desktop app.
The synthetic preview cannot be placed into Live with this adapter.

## Make a workflow yours

Only these five fields are accepted:

```json
{
  "schema_version": "mwa_workflow_template_v1",
  "workflow": "create-idea",
  "name": "My sunset idea",
  "genre": "deep_house",
  "prompt": "Warm deep house with soft chords, a rounded groove and an airy breakdown. Instrumental."
}
```

Supported IDs: `create-idea`, `make-variation`, `bring-to-ableton`. Names allow 120
UTF-8 bytes, prompts 1500. Only the nine documented genres are accepted. Unknown
fields are rejected: no scripts, module imports, remote URLs, credentials, account
IDs, prices, trial flags or raw DAW commands. Import is not a generation request.

Save keeps up to twelve templates in **this browser's localStorage**; matching
name/workflow replaces the saved preference. Export produces public JSON. Neither
operation invokes MWA. Clearing browser storage removes preferences. Templates
contain your prompt; do not save/share confidential text. Recognizable key patterns
are rejected as a convenience, not a comprehensive secret detector.

Try the [template](../examples/workflows/create-idea.json) or
[lesson](../examples/workflows/teacher-lesson.json). Offline preparation:

```sh
node examples/workflows/prepare.mjs --template examples/workflows/create-idea.json
```

This prints **public SDK convenience input**, not the full versioned HTTP envelope.
To use it in your server, pass that input to the existing SDK:

```js
import { MwaClient } from "./packages/sdk/index.js";
import { workflowRequest } from "./public/workflow-templates.mjs";

const input = workflowRequest(myValidatedTemplate);
// For variation: workflowRequest(myValidatedTemplate, ownedReadyGenerationId).
// First check ownership, API access, price and balance in your application.
const mwa = new MwaClient({ apiKey: process.env.MWA_API_KEY });
const idempotencyKey = crypto.randomUUID();
// Persist the exact input and this key before explicit paid submission.
const job = await mwa.generate(input, { idempotencyKey });
const result = await mwa.wait(job.generation_id);
```

The snippet makes a potentially paid request if executed. Template preparation
does not. The template helper is a separate example module, not an addition to
the five-file SDK. No private workers, prompts, models or app modules are imported.

## Teacher lessons

Enter attribution, an objective and workflow preferences, review the sharing
checkbox and explicitly create a link or export. Links use
`/workflows#lesson=<base64url-json>`. The fragment is not part of the HTTP request;
anyone with the link can read it. It is not encrypted or signed. The page uses
`no-referrer`. Attribution is unverified author-supplied text.

Optional `example_id` refers only to a publication-approved track in this site's
showcase. It cannot supply an arbitrary audio URL; missing examples fall back to
the labeled synthetic sample. Imported lessons do not auto-save, autoplay,
generate, inspect Live or import audio. Parent IDs are selected locally, never
embedded in shared lessons.

To move a link between kit instances, retain its fragment and replace the origin
with the student's running local kit or hosted preview. Localhost requires their
kit to be running; it does not access the teacher's computer. The page accepts
bounded, validated JSON and renders user text with `textContent`.

Trial eligibility is absent from links/templates. A future private account adapter
must obtain it from MWA's server after authentication. Teachers cannot grant
credits through client configuration.

## Local example routes — not hosted MWA API endpoints

These require the existing same-origin session and CSRF header after `/api/config`.

| Route | Behaviour |
| --- | --- |
| `GET /api/workflows/readiness` | Read configuration only; return unverified/unknown/blocked states. No account or Live probing. |
| `POST /api/workflows/prepare` | Validate `{template, parent_generation_id?}`; return SDK input and preview cost or unavailable live cost. No hosted request. |
| `POST /api/workflows/run` | **Demo-only**; validate again, require idempotency, use existing session ownership/limits. Live returns 409 before submission. |
| `POST /api/workflows/handoff` | Retain validated SDK input in one of ten session-scoped handoffs; return a playground URL. No submission. |
| `GET /api/workflows/handoff/{id}` | Read a handoff owned by this session. Restart clears it. |

Hosted endpoints/billing remain in [API docs](api.md). The SDK runtime is unchanged.
The local cookie is not an authenticated MWA account or multi-user gateway.
Public hosting remains preview-only.

## Private Desktop qualification before musician launch

Reuse the existing installer, browser sign-in, setup dashboard and Remote Script
installation. Do not publish its source or assume that public AbletonJS speaks
the private MIXWITHAI protocol. No private Desktop module was copied into this kit.

The next private integration must demonstrate:

1. Install on a fresh supported computer, sign in through the existing account
   flow and verify API entitlement separately from app credits. No Terminal,
   environment files or pasted keys in the musician journey.
2. Obtain an authoritative expiring server quote for the exact input and verified
   balance. Bind consent, quote, user and request fingerprint. Revalidate before
   submitting; reject client prices, teacher coupons/trials. Define charging and
   refund outcomes on MWA's server.
3. Keep credentials in the private process; expose narrow authenticated UI
   operations. Enforce ownership/credit limits server-side. Do not expose the
   loopback key proxy remotely.
4. Qualify a separately reviewed versioned adapter to the installed private bridge.
   Verify exact Set/track, preview/approval, retained audio and readback. No protocol
   swapping, raw commands, silent replay or automatic Live preference changes.
   Reuse existing private capabilities rather than duplicating its importer.
5. Run one **real** journey: install → sign in → customise → see cost → explicitly
   generate → listen → explicitly approve full-audio import. Lesson opening must
   remain non-billable and must not inspect or alter Live.

Installed applications can be inspected; a private repository does not make
shipped implementation undiscoverable. Keep generation logic, internal prompts,
models, asset authorization and service secrets server-side. Public requests and
responses are intentionally visible and documented.

## Five-musician pilot

Use five non-coding musicians on supported OS/Live combinations. Explain the task,
then observe without developer help. This release has **not** passed the real
pilot. Proposed launch gate: four complete the real journey independently. Record
installation/first-audio time, every failure and actual charged credits. Preview
completion does not count as live success.

Private log columns: participant alias, OS/Live/installer version, install minutes,
first-audio minutes, completion without help, failure stage, quoted credits,
charged credits, import readback, notes. Do not log keys, private prompts or local
paths. Use actual server billing, not zero-cost preview metadata. Hold the musician
campaign until connection, authentication, quotes and import acceptance pass.
