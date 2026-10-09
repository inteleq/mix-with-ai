import { mkdtemp, mkdir, copyFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { checkRelease, projectRoot } from "./check-release.mjs";

const files = await checkRelease();
const temporary = await mkdtemp(join(tmpdir(), "mwa-public-release-"));
const releaseDir = resolve(projectRoot, "release");
await mkdir(releaseDir, { recursive: true });
const archive = resolve(releaseDir, "mwa-music-starter.tar.gz");
try {
  const stage = resolve(temporary, "mwa-music-starter");
  for (const file of files) {
    const destination = resolve(stage, file);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(resolve(projectRoot, file), destination);
  }
  const result = spawnSync("tar", ["-czf", archive, "-C", temporary, "mwa-music-starter"], { encoding: "utf8", env: { ...process.env, COPYFILE_DISABLE: "1" } });
  if (result.status !== 0) throw new Error("Archive creation failed. Install a standard tar utility and retry.");
  await writeFile(resolve(releaseDir, "CONTENTS.txt"), `${files.slice().sort().join("\n")}\n`);
  console.log(`Created release/mwa-music-starter.tar.gz (${files.length} allowlisted files).`);
  console.log("Extract into a new directory before creating your public GitHub repository.");
} finally { await rm(temporary, { recursive: true, force: true }); }
