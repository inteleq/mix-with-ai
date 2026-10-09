# SDK pilot candidate

The SDK candidate is `@mixwithai/music-client@0.1.0-beta.3`. Its package configuration uses the `beta` dist-tag. The proposed package name and scope still require publisher ownership confirmation; preparing a tarball does not reserve that name or publish anything.

```sh
npm install
npm run verify
npm run sdk:pack
```

The pack command works offline, uses the SDK's explicit file list, rejects unexpected package contents, and imports the extracted tarball in a temporary directory outside the starter. It compares each extracted file with the reviewed source, checks the dependency/import boundary, and exercises all client operations through offline HTTP fixtures. The fixtures assert public routes, disabled redirects, no automatic artifact downloads and no MWA key on the signed reference transfer. No live API calls are made.

Outputs are written under `release/`: the SDK `.tgz` and `sdk-package-evidence.json` with its SHA-256 and checked file list. The archive contains exactly `index.js`, `index.d.ts`, `package.json`, `README.md`, and `LICENSE`. The UI, local server, fixtures, receipts, and any other application implementation are excluded.

Install the candidate into your own test project by its local `.tgz` path. This is a real package-installable artifact and does not assume a package already exists on npm.

## Pilot scope

The client supports the documented MWA EDM generation profile, status, cancellation, variations/remixes, eligible export retries, reference guidance and private reference upload/read/completion/removal/polling. Reference uploads require deployment enablement and an owned completed saved generation. A ready reference with guidance_available=true can guide a paid revision in the same project. See `packages/sdk/README.md` for scopes, options and recovery.

Export retries have a separate lifecycle from the original job audit status. After requesting a retry, use `wait(id, { waitForAudio: true })` and inspect `audio_export.status` when it returns.

Before registry publication or broad promotion, verify the full supported workflow with an approved API account and authorized test spend: an original track, variations/remixes, replay after interruption, cancellation, downloadable output integrity, and correct billing. Static/fixture tests and authentication-denial probes are useful evidence, but do not establish musical quality, availability, or production settlement.

Keep paid generation, publication, and distribution of test audio as separate reviewed operations. A pilot output is not automatically an approved public showcase sample.

## Publication checkpoint

- Confirm ownership of the final package scope/name and a real repository URL.
- Review the exact tarball file list, SHA-256, version, and beta tag.
- Record the supported API version and known limitations.
- Confirm the pilot's live lifecycle and listening evidence.
- Publish only after explicit authorization for that package and artifact.

No publishing command is part of `sdk:pack`, `verify`, or the CI workflow.
