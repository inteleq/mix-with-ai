import test from "node:test";
import assert from "node:assert/strict";
import { renderDemoAudio } from "../server/demo-audio.mjs";

test("original preview is a valid, non-silent, unclipped 15-second stereo WAV", () => {
  const wav = renderDemoAudio("deep_house");
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt32LE(40), 15 * 22050 * 4);
  assert.equal(wav.length, 44 + wav.readUInt32LE(40));
  let peak = 0, energy = 0;
  for (let i = 44; i < wav.length; i += 2) { const value = wav.readInt16LE(i); peak = Math.max(peak, Math.abs(value)); energy += value * value; }
  assert.ok(peak > 1000 && peak < 32767);
  assert.ok(Math.sqrt(energy / ((wav.length - 44) / 2)) > 1000);
});
