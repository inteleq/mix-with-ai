import { MwaClient, MwaApiError, createRequest, GENRES, type Generation, type Genre } from "../packages/sdk/index.js";

const mwa = new MwaClient({ apiKey: "type-test-only" });
const genre: Genre = GENRES[0];
const request = createRequest({ prompt: "An instrumental house track", genre });
const duration: 180 = request.duration_seconds;
const audio: true = request.outputs.master_audio;
const result: Promise<Generation> = mwa.wait("example-id", { onProgress: job => { const progress: number = job.progress; void progress; } });
const retry: Promise<Generation> = mwa.retryExport("example-id", { idempotencyKey: "example-key" });
const audioRecovery: Promise<Generation> = mwa.wait("example-id", { waitForAudio: true });
const failure = new MwaApiError("Example", { status: 429, retryAfterMs: 3000 });
void [duration, audio, result, retry, audioRecovery, failure];
createRequest({ prompt: "A track", genre: "house", referenceGuidance: { mode: "auto" } });
createRequest({ prompt: "A track", genre: "house", referenceGuidance: { mode: "off" } });
// @ts-expect-error Reference uploads are outside the public guidance contract.
createRequest({ prompt: "A track", genre: "house", referenceGuidance: { mode: "auto", audio_url: "https://example.com/audio.mp3" } });
// @ts-expect-error Guidance has only two supported modes.
createRequest({ prompt: "A track", genre: "house", referenceGuidance: { mode: "upload" } });

// @ts-expect-error Unknown genres must not be accepted.
createRequest({ prompt: "A track", genre: "not-a-genre" });
// @ts-expect-error An idempotency key is required for a submission.
mwa.generate({ prompt: "A track", genre: "house" });
// @ts-expect-error MIDI output is outside this profile.
createRequest({ prompt: "A track", genre: "house", midi: true });

const reference = mwa.uploadReference("example-id", new Blob(), {filename:"reference.wav",durationSeconds:12,userOwnsAudio:true,idempotencyKey:"saved-upload-key"});
void reference;
createRequest({prompt:"A variation",genre:"house",revision:{parent_generation_id:"example-id",kind:"variation"},reference:{reference_id:"example-id",content_sha256:"example-hash"}});
// @ts-expect-error Uploaded audio needs an explicit ownership confirmation.
mwa.uploadReference("example-id",new Blob(),{filename:"reference.wav",durationSeconds:12,userOwnsAudio:false,idempotencyKey:"key"});
// @ts-expect-error A reference binds its immutable audio hash.
createRequest({prompt:"A variation",genre:"house",reference:{reference_id:"example-id"}});
