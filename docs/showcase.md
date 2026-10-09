# Curate the public track showcase

The showcase reads `showcase.json`. Its track list is initially empty while approved campaign audio is being selected. The page shows a deliberate empty state rather than presenting synthesized fixture audio as MWA output.

Add permanent public audio URLs that you have approved for redistribution and campaign use. This project does not fetch recordings from an MWA account or copy audio from another application repository.

## Add an approved track

The following is an illustrative entry. Replace the example URL and metadata with your actual approved track before using it:

```json
{
  "tracks": [
    {
      "id": "golden-hour",
      "title": "Golden hour",
      "genre": "deep_house",
      "prompt": "The actual public prompt used for this track",
      "audioUrl": "https://cdn.example.com/approved/golden-hour.mp3",
      "credit": "MixWithAI campaign sample",
      "publicationApproved": true
    }
  ]
}
```

Restart the starter after editing. Run `npm run check` before packaging; it validates this manifest as well as the code release boundary.

`prompt` is optional. A track with no shared prompt is still playable; its prompt reuse action is disabled. Titles, credits, genre values, and public URLs are the only published metadata. Do not add internal prompts, generation IDs, storage keys, account identifiers, or operational data.

An optional `variantOf` field can refer to another track's public slug in the same manifest. This enables selecting an original/variation pair in the A/B interface. It is a public showcase relationship, not a private API job identifier.

The player links directly to the approved public URL; the starter does not download or proxy it. Use an HTTPS URL without credentials, a query, or a fragment. Temporary signed artifact URLs are intentionally rejected because they expire and can contain bearer credentials. Save a cleared output to your own public campaign host first.

The declaration `publicationApproved: true` records the curator's assertion; it is not an automated license check. The MIT code license does not grant rights to an external recording. Keep the appropriate permission evidence with your campaign records.

## What visitors can do

- Play an approved track and read its credit.
- Reveal a public prompt when one was shared.
- Reuse that prompt in the generation form; this action does not submit a job.
- Add the track to the A/B comparison player.

The separately labeled A/B demonstration uses original 15-second synthesized fixtures. Those are included to make the comparison interface runnable without an account and are never shown as proof of MWA generation quality.
