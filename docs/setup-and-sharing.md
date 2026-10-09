# From preview to your first track

Start with Node.js 22.16 or newer and `npm start`. The preview works without an account, installation, or network access. The expanded setup guide beside the prompt shows the path to a live track.

## Guided local setup

```sh
npm run setup
npm start
```

Choose Preview or Live in the terminal wizard. For Live, first get an active API key and API credits at [MixWithAI API access](https://mixwithai.com/settings/api). Save the key in a regular local file outside your public repository and restrict its permissions with `chmod 600`. The file can contain the key as plain text or JSON with a `key` field. Enter only the file path in the wizard.

The wizard writes a protected `.env` in this starter with a loopback-only host. It reads the key without printing it, makes no API requests, and asks before replacing an existing `.env`. Restart the server after changing settings. Keep `.env` and the source key file out of Git and archives.

“Server key configured” confirms local configuration. It does not establish that the key is active, admitted, funded, or that MWA workers are available. A successful generation with ready audio confirms the last guide step. Failed requests report their API error; the starter does not automatically submit a replacement song.

## Share cards

After a track is ready, choose **Create share card**. Edit its card title, review the preview, download the 1200×630 PNG, and optionally copy the caption. Prompt inclusion is off each time the dialog opens. Enabling it includes up to 220 characters of your prompt in the card and caption.

Cards render locally using canvas and system fonts. No audio, waveform analysis, images, or metadata are uploaded. Card generation and copying make no API call and consume no credits. The export uses only title, genre, the optional prompt, and a campaign link to MixWithAI. Generation IDs, ownership, project links, and signed audio downloads are excluded. URL-like text and MWA key-like strings in the chosen title or prompt are omitted as an additional guard. Review your own text before sharing.

Preview cards retain a visible **SYNTHESIZED DEMO / NOT MWA-GENERATED** label. Live cards identify the MWA API. The line artwork is decorative, not a measured waveform. The caption's link carries `utm_source=share_card`, `utm_medium=social`, and the configured campaign name. Those parameters attribute arrivals; this starter includes no analytics service or automatic posting.

The functions in `public/share-card.js` can be reused in your own interface. `public/generation-state.js` keeps export processing separate from the original job status, so a retried export can finish even when the original job remains failed.
