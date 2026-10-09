/** Original fixture synthesis for this starter. No samples, models, or MWA engine code. */
export function renderDemoAudio(genre = "tech_house", variant = "original") {
  const rate = 22050;
  const seconds = 15;
  const frames = rate * seconds;
  const wav = Buffer.alloc(44 + frames * 4);
  wav.write("RIFF", 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
  wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 4, 28);
  wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(frames * 4, 40);
  const beat = 60 / 128;
  const baseRoot = genre === "trance" ? 65.406 : genre === "deep_house" ? 55 : 61.735;
  const root = baseRoot * (variant === "remix" ? 2 ** (-2 / 12) : 1);
  const notes = variant === "variation" ? [0, 10, 14, 19, 14, 7, 10, 3] : variant === "remix" ? [0, 3, 7, 10, 12, 10, 7, 3] : [0, 7, 10, 14, 7, 3, 10, 7];
  let seed = 7817;
  for (let i = 0; i < frames; i++) {
    const t = i / rate;
    const phase = t % beat;
    const kick = Math.sin(2 * Math.PI * (46 * phase + 2.8 * (1 - Math.exp(-phase * 35)))) * Math.exp(-phase * 18) * 0.55;
    const offbeat = (t + beat / 2) % beat;
    const bass = (Math.sin(2 * Math.PI * root * t) + 0.2 * Math.sin(4 * Math.PI * root * t)) * Math.exp(-offbeat * 12) * 0.18;
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const hat = (seed / 0xffffffff * 2 - 1) * Math.exp(-(t % (beat / (variant === "remix" ? 4 : 2))) * 130) * (variant === "variation" ? 0.045 : 0.07);
    const note = root * 4 * 2 ** (notes[Math.floor(t / (beat / 2)) % notes.length] / 12);
    const pluck = Math.sin(2 * Math.PI * note * t) * Math.exp(-(t % (beat / 2)) * 15) * 0.075;
    const fade = Math.min(1, t / 0.04, (seconds - t) / 0.3);
    const left = Math.tanh(kick + bass + hat + pluck) * fade;
    const right = Math.tanh(kick + bass + hat * 0.75 + pluck * (0.7 + 0.3 * Math.sin(t))) * fade;
    wav.writeInt16LE(Math.round(left * 28000), 44 + i * 4);
    wav.writeInt16LE(Math.round(right * 28000), 46 + i * 4);
  }
  return wav;
}
