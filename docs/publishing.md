# Publish this starter

## Prepare the GitHub identity

Choose an owner and repository name. From this folder:

```sh
npm run prepare:github -- --repo YOUR_OWNER/YOUR_REPOSITORY
```

This writes your repository URL to `site.config.json` and updates the README's star, fork, and showcase links. It does not create a GitHub repository, push, publish a package, or contact a remote service. The interface shows its GitHub star action only after a repository URL is configured.

Suggested repository name: **mwa-music-starter**.

Suggested description: **Build music apps with the MWA API. Includes a working playground, typed JavaScript client, and generation examples.**

Suggested topics: `music`, `music-generation`, `music-api`, `audio`, `javascript`, `typescript`, `developer-tools`, `starter-template`, `mixwithai`.

Enable GitHub's **Template repository** setting so developers can use the starter without forking its history. Enable Discussions if you intend to maintain a community. The included showcase issue form works without Discussions. Add your deployed preview URL to the repository's Website field once it exists.

## Make a clean public archive

```sh
npm install
npm run verify
npm run release
```

The archive is `release/mwa-music-starter.tar.gz`. Only paths listed in `release-manifest.json` are included. The script rejects symlinks, imports escaping this folder, suspicious credential patterns, and accidental local paths. It does not package `.env`, dependencies, generated requests, receipts, Git history, or neighboring directories.

Extract the archive **outside any existing private repository** and publish from that extracted folder. That produces a new repository with only starter files and new Git history. Do not make an existing private repository public or add it as the starter's remote.

Review the archive file list and Git staged changes before pushing. Automated checks are a useful guard, not a guarantee that every future change is publishable.

## Host the public preview

The default mode is a labeled local fixture. For an HTTPS reverse proxy or container platform, set:

```text
MWA_MODE=demo
HOST=0.0.0.0
PORT=3008
PUBLIC_ORIGIN=https://your-preview.example
```

`PUBLIC_ORIGIN` must match the browser-visible origin. Your reverse proxy must preserve the original `Host` header. The server ignores forwarded-host headers. API keys are ignored in demo mode; omit them entirely from a public preview deployment.

```sh
docker build -t mwa-music-starter .
docker run --rm -p 127.0.0.1:3008:3008 \
  -e PUBLIC_ORIGIN=https://your-preview.example \
  mwa-music-starter
```

Place your HTTPS reverse proxy in front of that port. No database or paid model is required. The process keeps bounded preview sessions in memory; replicas need sticky sessions or a shared session store. The fixture cache contains at most one original synthesized WAV per supported genre.

Live mode is local-only in this release. Before hosting your own live fork, implement authentication, durable user/job ownership, durable idempotency records, per-user and account-wide spending controls, deployment-appropriate CSRF protection, and artifact retention. The starter's in-memory local limits are not production billing controls.

## Campaign assets

`marketing/social-card.png` is a ready-to-upload 1280×640 original banner, also used in the README. Its editable vector source is `marketing/social-card.svg`. Configure absolute social-image metadata after you know the public deployment URL; the starter avoids inventing one.

Launch copy, a recording script, and measurement guidance live in `marketing/CAMPAIGN.md`. Record live output only after a real authorized generation succeeds. Preview recordings must retain the preview label.
