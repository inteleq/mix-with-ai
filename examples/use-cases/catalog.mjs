/** Public, independently authored prompts and integration recipes. No engine code. */
export const USE_CASES = [
  {
    id: "music-studio", title: "Prompt-to-music studio", label: "Generate a track",
    keywords: ["generate", "prompt", "music"],
    summary: "Turn a musical brief into a playable electronic track with progress and saved versions.",
    build: "A prompt editor, genre selector, progress timeline and private output library.",
    methods: ["generate", "wait", "get"], scopes: ["generations:create", "generations:read"],
    steps: ["Save the musical brief and a request key.", "Submit once and persist the generation ID.", "Follow job and audio status, then play or download the ready output."],
    limit: "The supported profile creates a 180-second electronic track at 128 BPM; it does not support arbitrary durations or streaming generation.",
    input: { prompt: "Warm instrumental deep house with soft chords, a rolling bass, crisp drums and a spacious breakdown. No vocals.", genre: "deep_house", title: "Golden hour" },
  },
  {
    id: "mix-master", title: "AI mix and master workflow", label: "Generated-track revision",
    keywords: ["mixing", "mastering", "production"],
    summary: "Explore a clearer production direction on an MWA-generated track, then audition its exported audio.",
    build: "A production brief editor with before/after listening and notes about balance, low end and space.",
    methods: ["generate", "wait", "get", "retryExport"], scopes: ["generations:create", "generations:read"], revisionKind: "variation",
    steps: ["Choose an owned completed generation and describe the production changes.", "Save a new revision key and request a variation.", "Compare the two ready audio exports. Retry an export only if can_retry is true."],
    limit: "This is a new paid musical revision with hosted audio export. The public API has no standalone mix/master endpoint for arbitrary songs or uploaded stems, no fixed-mix preservation, and no LUFS or mastering controls. Export retry is recovery, not a mastering effect.",
    input: { prompt: "Keep the deep house mood. Aim for a clearer balance: a focused bass, a punchy kick, less crowded low mids, restrained reverb and crisp percussion. Instrumental.", genre: "deep_house", title: "Golden hour — production variation" },
  },
  {
    id: "sound-character", title: "Explore a sound’s character", label: "Describe a new direction",
    keywords: ["recreate", "sound", "timbre", "bass", "lead"],
    summary: "Describe the qualities of a bass, lead or texture and explore them in a new full track.",
    build: "A sound-description notebook that turns terms such as warm, plucky or metallic into track briefs.",
    methods: ["generate", "wait", "get"], scopes: ["generations:create", "generations:read"],
    steps: ["Describe timbre, envelope, musical role and arrangement in ordinary language.", "Save the prompt and request key, then generate a track.", "Audition the result and request intentional revisions to explore another direction."],
    limit: "Describing a sound is creative direction, not exact recreation. The API returns a full track; it has no isolated sound-cloning, sample-extraction or synthesizer-preset endpoint. Uploaded references provide arrangement/energy guidance, not timbre matching.",
    input: { prompt: "Instrumental bass house with a warm rounded plucky bass, a short attack, a dry rhythmic groove and airy metallic accents. Leave space for the bass motif in the breakdown.", genre: "bass_house", title: "Pluck study" },
  },
  {
    id: "reference-guided", title: "Reference-guided variation", label: "Reference-upload beta",
    keywords: ["reference", "audio", "upload"],
    summary: "Use audio you own as arrangement and energy guidance for a saved project’s next version.",
    build: "A private reference brief with upload progress, analysis readiness and a guided revision action.",
    methods: ["uploadReference", "waitForReference", "generate", "wait"], scopes: ["generations:create", "generations:read"], revisionKind: "variation", needsReference: true,
    steps: ["Prepare a receipt for an owned file and completed parent generation; upload with the saved key.", "Wait for ready and guidance_available=true. Save the reference identity and source hash.", "Submit a paid variation in the same project using that reference and a new revision key."],
    limit: "Requires reference-upload deployment enablement, an owned completed saved generation and qualified guidance. One active whole-track arrangement reference per project. No exact recording recreation or passage replacement.",
    input: { prompt: "Keep the deep house mood; use my reference for arrangement and energy. Make the breakdown spacious and build toward a confident final section. Instrumental.", genre: "deep_house", title: "Reference direction" },
  },
  {
    id: "soundtrack", title: "Soundtracks for creators", label: "Scene-to-music brief",
    keywords: ["video", "game", "soundtrack"],
    summary: "Build an audition workflow for a video, game scene or creative installation.",
    build: "A scene brief, mood notes and a player beside the creator’s own visual preview.",
    methods: ["generate", "wait", "get"], scopes: ["generations:create", "generations:read"],
    steps: ["Translate the scene into mood, instrumentation and arrangement notes.", "Generate a supported electronic track with a saved request key.", "Audition against the scene and handle trimming/synchronization in your own editor."],
    limit: "Output remains 180 seconds and 128 BPM. Exact picture sync, arbitrary cue lengths, adaptive game audio and stem delivery are outside this API profile. Review applicable output terms for your distribution.",
    input: { prompt: "Instrumental melodic house for a nighttime city journey: restrained opening, warm evolving chords, steady movement and an uplifting final section. No vocals.", genre: "melodic_house", title: "Night journey" },
  },
  {
    id: "ab-remix", title: "A/B remix lab", label: "Compare saved versions",
    keywords: ["comparison", "remix", "versions"],
    summary: "Keep an original track and audition an intentional remix alongside it.",
    build: "Two labeled versions, a single audition player, prompt comparison and private favorites.",
    methods: ["get", "generate", "wait"], scopes: ["generations:create", "generations:read"], revisionKind: "remix",
    steps: ["Read the owned original and keep its generation ID.", "Save a new remix input/key and submit against that parent.", "Read fresh delivery for both versions and use the starter’s A/B room as a UI example."],
    limit: "A remix is a new paid generation, not a deterministic audio edit. Wait for both audio exports and keep signed URLs private; the starter A/B room is a UI example, not another API endpoint.",
    input: { prompt: "An instrumental deep house remix with a more energetic groove, syncopated percussion, spacious chords and a longer-feeling breakdown. Keep the late-night mood.", genre: "deep_house", title: "After hours — remix" },
  },
];

export function getUseCase(id) {
  const recipe = USE_CASES.find(item => item.id === id);
  if (!recipe) throw new TypeError("Unknown use case. Choose a recipe from examples/README.md.");
  return recipe;
}

export function buildUseCaseInput(id, { parentGenerationId, referenceReceipt } = {}) {
  const recipe = getUseCase(id);
  const input = { ...recipe.input };
  if (recipe.revisionKind) {
    if (!parentGenerationId) throw new TypeError("This recipe needs an owned parent generation UUID.");
    input.revision = { parent_generation_id: parentGenerationId, kind: recipe.revisionKind };
  }
  if (recipe.needsReference) {
    if (!referenceReceipt || referenceReceipt.status !== "ready" || referenceReceipt.guidance_available !== true || String(referenceReceipt.generation_id).toLowerCase() !== String(parentGenerationId).toLowerCase()) {
      throw new TypeError("Use a ready qualified reference receipt for this parent generation.");
    }
    input.reference = { reference_id: referenceReceipt.reference_id, content_sha256: referenceReceipt.content_sha256 };
    input.referenceGuidance = { mode: "auto" };
  } else if (referenceReceipt) throw new TypeError("Choose reference-guided to select an uploaded reference.");
  return input;
}
