import { readFile } from "node:fs/promises";
import { readConfig } from "./config.mjs";
import { createStarterServer } from "./app.mjs";

const site = JSON.parse(await readFile(new URL("../site.config.json", import.meta.url), "utf8"));
try {
  const config = readConfig(process.env, site);
  const showcase = JSON.parse(await readFile(new URL("../showcase.json", import.meta.url), "utf8"));
  const useImport = process.argv.includes("--ableton-import");
  const useAbleton = process.argv.includes("--ableton") || useImport;
  if (useImport && config.mode !== "live") throw new Error("Audio import requires live MWA mode. Configure your key with npm run setup, then explicitly run npm run ableton:import.");
  if (useAbleton && (config.host !== "127.0.0.1" || config.publicOrigin)) throw new Error("Ableton capture requires a local, loopback-only starter.");
  const readProject = useAbleton ? async () => {
    const { readAbletonProject } = await import("../integrations/ableton/read.mjs");
    return readAbletonProject();
  } : undefined;
  const audioImporter = useImport ? {
    inspect: async () => (await import("../integrations/ableton/read.mjs")).abletonAudioImporter.inspect(),
    apply: async input => (await import("../integrations/ableton/read.mjs")).abletonAudioImporter.apply(input),
  } : undefined;
  const server = createStarterServer(config, { showcase, readProject, audioImporter });
  server.on("error", () => { console.error("Could not start the server. Check PORT and HOST."); process.exitCode = 1; });
  server.listen(config.port, config.host, () => {
    console.log(`MWA Music Starter · ${config.mode === "demo" ? "preview mode (no API calls)" : "live mode"}`);
    console.log(config.publicOrigin || `http://127.0.0.1:${server.address().port}`);
    if (useAbleton) console.log("Project reader enabled · open /project and capture explicitly. No automatic Live reads or writes.");
    if (useImport) console.log("Reviewed audio import enabled · ready live generations only, empty audio tracks, explicit preview and confirmation. No automatic import.");
  });
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => server.close(() => process.exit(0)));
} catch (error) { console.error(error.message); process.exitCode = 1; }
