import { Ableton } from "ableton-js";
import { captureProject } from "./capture.mjs";
import { inspectAudioTargets, applyAudioToEmptyTrack } from "./import-audio.mjs";

export function readAbletonProject() {
  const client = new Ableton({ disableCache: true, commandTimeoutMs: 1500 });
  // Do not attach a raw logger: responses can include the user's session data.
  client.on("error", () => {});
  return captureProject(client);
}

async function withClient(action) {
  const client = new Ableton({ disableCache: true, commandTimeoutMs: 1500 });
  client.on("error", () => {});
  let expired = false;
  let timer;
  const check = () => { if (expired) throw new Error("The local Ableton operation deadline expired."); };
  const operation = async () => { await client.start(5000); check(); return action(client, check); };
  try {
    return await Promise.race([operation(), new Promise((_, reject) => { timer = setTimeout(() => {
      expired = true; reject(new Error("The local Ableton operation deadline expired."));
    }, 20000); })]);
  } finally { expired = true; clearTimeout(timer); await client.close(); }
}

export const abletonAudioImporter = {
  inspect: () => withClient(inspectAudioTargets),
  apply: input => withClient((client, check) => applyAudioToEmptyTrack(client, input, check)),
};
