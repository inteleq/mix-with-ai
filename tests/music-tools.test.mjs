import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { buildCodeExamples } from "../public/code-examples.js";
import { createRequest } from "../packages/sdk/index.js";
import { choosePair, clampSeek, createComparisonPlayer } from "../public/comparison.js";
import { readShowcase } from "../server/showcase.mjs";

const input = { prompt: "Warm chords, a rounded bassline and an airy breakdown", genre: "deep_house", title: "Golden hour" };
const key = "example-stable-request";
const id = "10000000-0000-4000-8000-000000000001";

test("all interactive examples represent the same supported SDK request, including revisions", () => {
  for (const candidate of [input, { ...input, revision: { parent_generation_id: id, kind: "variation" } }]) {
    const examples = buildCodeExamples(candidate, key);
    assert.deepEqual(examples.request, createRequest(candidate));
    assert.deepEqual(JSON.parse(examples.json), createRequest(candidate));
    for (const language of ["javascript", "python", "curl"]) assert.ok(examples[language].includes(key));
    assert.ok(examples.javascript.includes("process.env.MWA_API_KEY"));
    assert.ok(examples.python.includes('os.environ["MWA_API_KEY"]'));
    assert.ok(examples.python.includes("build_opener(NoRedirect())"));
    assert.ok(examples.curl.includes("$MWA_API_KEY"));
  }
});

test("example construction rejects invalid input and changes with form choices", () => {
  const a = buildCodeExamples(input, key);
  const b = buildCodeExamples({ ...input, genre: "techno", title: "After dark" }, key);
  assert.notEqual(a.javascript, b.javascript); assert.equal(b.request.title, "After dark");
  assert.throws(() => buildCodeExamples({ ...input, prompt: "💿".repeat(400) }, key), /UTF-8/);
  assert.throws(() => buildCodeExamples({ ...input, genre: "unknown" }, key), /genre/);
});

test("JavaScript and shell examples remain syntactically valid for hostile-looking prompt text", () => {
  const tricky = { ...input, prompt: "A producer's groove; $(touch /tmp/never-created) `echo nope` \"double\" \\ slash\nnew line", title: "Don't break" };
  const examples = buildCodeExamples(tricky, key);
  const javascript = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: examples.javascript, encoding: "utf8" });
  assert.equal(javascript.status, 0, javascript.stderr);
  const shell = spawnSync("sh", ["-n"], { input: examples.curl, encoding: "utf8" });
  assert.equal(shell.status, 0, shell.stderr);
  // Parsing checks do not execute a request or the prompt contents.
});

test("Python example is parseable, including UTF-8 and escaped JSON", t => {
  const examples = buildCodeExamples({ ...input, prompt: "Café grooves with 'warmth' and \"space\"\nA second line" }, key);
  const parsed = spawnSync("python3", ["-c", "import ast,json,sys; tree=ast.parse(sys.stdin.read()); assignment=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='payload' for t in n.targets)); print(json.dumps(json.loads(ast.literal_eval(assignment.value.args[0]))))"], { input: examples.python, encoding: "utf8" });
  if (parsed.error?.code === "ENOENT") { t.skip("Python syntax check requires python3; SDK and server tests still run without it."); return; }
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.deepEqual(JSON.parse(parsed.stdout), examples.request);
});

test("pair selection prefers a ready parent/variation and preserves explicit choices", () => {
  const tracks = [{ id: "demo-a" }, { id: "demo-b" }, { id: "parent" }, { id: "child", parentId: "parent" }];
  assert.deepEqual(choosePair(tracks, {}, "child"), { a: "parent", b: "child" });
  assert.deepEqual(choosePair(tracks, { a: "demo-b", b: "parent" }), { a: "demo-b", b: "parent" });
  const duplicate = choosePair(tracks, { a: "parent", b: "parent" });
  assert.notEqual(duplicate.a, duplicate.b);
  assert.deepEqual(choosePair([]), { a: "", b: "" });
});

class FakeAudio extends EventTarget {
  paused = true;
  currentTime = 0;
  duration = 15;
  src = "";
  getAttribute() { return this.src || null; }
  removeAttribute() { this.src = ""; }
  load() { this.currentTime = 0; }
  pause() { this.paused = true; this.dispatchEvent(new Event("pause")); }
  async play() { this.paused = false; this.dispatchEvent(new Event("play")); }
  metadata(duration) { this.duration = duration; this.dispatchEvent(new Event("loadedmetadata")); }
}

test("A/B player preserves position and clamps it for a shorter track with a single media element", async () => {
  const audio = new FakeAudio();
  const player = createComparisonPlayer(audio);
  player.setPair({ audioUrl: "/a.wav" }, { audioUrl: "/b.wav" }); audio.metadata(15);
  await player.switchTo("A"); audio.currentTime = 12;
  await player.switchTo("B"); audio.metadata(8);
  assert.equal(player.active(), "B"); assert.equal(audio.src, "/b.wav");
  assert.equal(audio.currentTime, 7.95); assert.equal(audio.paused, false);
  assert.equal(clampSeek(NaN, 15), 0); assert.equal(clampSeek(-2, 15), 0);
});

test("rapid A/B switching retains the pending listening position before metadata arrives", async () => {
  const audio = new FakeAudio(); const player = createComparisonPlayer(audio);
  player.setPair({ audioUrl: "/a.wav" }, { audioUrl: "/b.wav" }); audio.metadata(15);
  audio.currentTime = 5;
  await player.switchTo("B"); await player.switchTo("A"); audio.metadata(15);
  assert.equal(audio.currentTime, 5); assert.equal(audio.src, "/a.wav");
});

test("A/B play rejection reports useful feedback instead of claiming successful playback", async () => {
  const audio = new FakeAudio(); audio.play = async () => { throw new Error("play blocked"); };
  const messages = [];
  const player = createComparisonPlayer(audio, { onError: message => messages.push(message) });
  player.setPair({ audioUrl: "/a.wav" }, { audioUrl: "/b.wav" }); audio.metadata(15);
  assert.equal(await player.switchTo("B"), false); assert.match(messages[0], /play button/);
});

test("showcase accepts approved permanent URLs and excludes unpublished or credential-bearing entries", () => {
  const track = { id: "sunset", title: "Sunset", genre: "deep_house", audioUrl: "https://cdn.example.com/sunset.mp3", credit: "Example campaign owner", publicationApproved: true };
  const published = readShowcase({ tracks: [track, { ...track, id: "sunset-variation", variantOf: "sunset" }] });
  assert.equal(published[0].source, "mwa_api"); assert.equal(published[0].prompt, null);
  assert.equal(published[1].parentId, "sunset");
  assert.throws(() => readShowcase({ tracks: [{ ...track, publicationApproved: false }] }), /publicationApproved/);
  for (const audioUrl of ["https://cdn.example.com/song.mp3?token=do-not-publish", "http://cdn.example.com/song.mp3", "https://user:password@cdn.example.com/song.mp3", "https://127.0.0.1/song.mp3"]) {
    assert.throws(() => readShowcase({ tracks: [{ ...track, audioUrl }] }), /permanent public HTTPS/);
  }
  assert.throws(() => readShowcase({ tracks: [{ ...track, variantOf: "not-published" }] }), /variantOf/);
  assert.throws(() => readShowcase({ tracks: [{ ...track, private_metadata: "not-allowed" }] }), /public track metadata/);
});
