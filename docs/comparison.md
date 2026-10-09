# Run and extend the A/B comparison app

Run `npm start` and open the **Compare** section. It works immediately with two original, clearly labeled synthesized fixtures. Real MWA output can be compared after you generate tracks with your API key or add approved public showcase tracks.

Choose a track for A and another for B. **Listen A** and **Listen B** use one native audio element, switch its source, and preserve the current time position. If a track is shorter, the position is clamped near its end. This is a listening comparison, not beat alignment, sample synchronization, or loudness normalization.

All audio players on the page pause their peers when playback starts. The comparison room therefore does not play over a showcase or playground track.

## Compare an original and variation

1. Generate an original using live mode and your approved MWA key.
2. Wait for its audio to be ready.
3. Choose **Make a variation** or **Remix**, adjust the prompt, and submit a new intentional generation.
4. When the child's audio becomes ready, the comparison room selects the ready parent for A and child for B. It reads the owned parent's status if necessary.
5. Audition the versions or use the selectors to compare another pair.

Each new revision can consume API credits. The A/B player itself only plays available audio and reads status when refreshing an expiring owned download link; switching sides does not generate music.

Ready session audio is held in browser memory and can be selected alongside approved showcase audio. Refreshing the page does not persist signed URLs. Session history lets the playground read status again, and comparisons refresh an expiring generation link when possible. Expired artifacts may no longer be available; choose another track or open its saved MWA project.

## Reuse the player

`public/comparison.js` exports `createComparisonPlayer`, `choosePair`, and `clampSeek`. The player accepts an audio element and two track objects containing `audioUrl`; optional metadata can drive your own labels. The source files are independent of a framework or the hosted generation implementation.

```js
import { createComparisonPlayer } from "./comparison.js";

const player = createComparisonPlayer(document.querySelector("audio"), {
  onState: ({ active, track, playing }) => {
    // Update your own labels and selected-side indicator.
  },
  onError: message => {
    // Show a helpful inline message.
  },
});

player.setPair(
  { title: "Original", audioUrl: "/your-approved-original.mp3" },
  { title: "Variation", audioUrl: "/your-approved-variation.mp3" },
);

// Call from an explicit user interaction.
await player.switchTo("B");
```

Copy the module into your own public frontend and use your own cleared audio sources. Keep generation API credentials in your server process.
