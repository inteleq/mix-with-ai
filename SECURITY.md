# Security

The starter keeps API credentials in the server environment. It never serves `.env` or the SDK directory as browser assets. Live mode is loopback-only. Its cookie sessions, CSRF checks, ownership map, and limits are development safeguards; they are not a hosted multi-tenant security system.

For a suspected vulnerability, use this repository's GitHub private vulnerability reporting when enabled. Do not include keys or private account data in public issues. The maintainer should enable private reporting under GitHub's Security settings before launch.

If a key has been exposed, revoke it in the MWA API console and create a new one. Removing it from the latest commit does not remove it from history.

The public demo is a local fixture and does not need a key. Before deploying a live fork, implement the application-level controls described in `docs/publishing.md`.

## Public SDK boundary

The SDK is an independently written HTTP client with public types. Its five-file package excludes the application UI/server, private repository imports, generation engine, analysis implementation, model weights, catalog and server credentials. It has no runtime dependencies, install hooks, filesystem access or telemetry. Music generation and analysis remain hosted in MWA.

Authenticated requests use the public generation/reference endpoints on `https://mixwithai.com` by default, with HTTPS required and redirects disabled. A reference transfer uses the signed HTTPS URL returned by MWA without the MWA Bearer key. The SDK does not fetch audio/project downloads. Fetch those separately without credentials and keep signed links private.

Custom `baseUrl` and `fetch` are trusted server configuration: the selected origin receives the key and custom fetch can inspect it. Never take them from an end user. Browser construction is rejected, but keys must still stay out of browser bundles, logs and public receipts. Shared-key applications must authenticate their own users and enforce receipt/reference ownership and quotas.

`npm run check` guards the SDK file/import/dependency boundary as part of the explicit starter release manifest. `npm run sdk:pack` checks the extracted package against source bytes and exercises every operation using offline HTTP fixtures, including storage credential separation. These guards and source review provide scoped evidence; they do not certify all possible integrations or live service readiness. See `packages/sdk/README.md` for the supported public contract.

## Optional project reader

The public Ableton example uses a separate locked upstream package and new
read-only adapter code. It contains no private MWA bridge imports or overlays and
never receives the API key. Enable it only on the loopback starter, use the matching
Remote Script, and stop competing connectors. Only explicit capture reads Live.
Local draft changes cannot dispatch commands or write into an existing MWA project.

Project cleaning constructs an allowlisted projection, bounds collections and
discards unsupported fields. Labels are omitted from selected context by default.
Review free text and exports: label filtering is not a guarantee of confidential
text detection. The server retains only bounded, session-owned handoff prompts;
full draft/context data is not persisted. It uploads no structured Ableton project
to hosted MWA. An explicitly submitted generation carries the exact reviewed
descriptive prompt through the existing SDK. Read [the integration guide](docs/ableton-projects.md)
for supported fields, limitations and the future hosted API authorization boundary.

The separate opt-in audio importer requires live mode, loopback binding, a saved
stopped Set, an unchanged empty track and an explicitly confirmed short-lived
preview. It accepts generation IDs, not caller URLs, paths or commands. The fresh
audio download carries no key/cookies, refuses redirects, bounds bytes and checks
integrity. Native paths stay local; symlinked cache/receipts are rejected. Exclusive
dispatch receipts, connector serialization and no replay after ambiguous results
reduce duplicate/overwrite risks. Keep Live idle; checks are not an atomic native
transaction. Do not promote the importer before real Live/OS acceptance. Read
[the audio import guide](docs/ableton-audio-import.md).
