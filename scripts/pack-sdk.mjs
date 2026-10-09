import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { checkRelease, projectRoot } from "./check-release.mjs";
import { SDK_PUBLIC_FILES, checkSdkBoundary, checkSdkTransport } from "./check-sdk-boundary.mjs";

await checkRelease();
const sdkRoot = resolve(projectRoot, "packages/sdk");
const pkg = JSON.parse(await readFile(join(sdkRoot, "package.json"), "utf8"));
if (!pkg.version.includes("-beta.") || pkg.publishConfig?.tag !== "beta") throw new Error("Prepare an explicitly beta-tagged SDK candidate before packing.");
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error("Review new SDK runtime dependencies before release.");
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error("Run this script with npm run sdk:pack.");
const temporary = await mkdtemp(join(tmpdir(), "mwa-sdk-pack-"));
const destination = resolve(projectRoot, "release");
await mkdir(destination, { recursive: true });
try {
  const pack = spawnSync(process.execPath, [npmCli, "pack", "--offline", "--ignore-scripts", "--json", "--cache", join(temporary, "cache"), "--pack-destination", destination], { cwd: sdkRoot, encoding: "utf8" });
  if (pack.status !== 0) throw new Error("Local SDK packing failed. No package was published.");
  const [report] = JSON.parse(pack.stdout);
  const expected = SDK_PUBLIC_FILES;
  const actual = report.files.map(file => file.path).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("Unexpected SDK tarball contents; review before publication.");
  const archive = resolve(destination, report.filename);
  const list = spawnSync("tar", ["-tzf", archive], { encoding: "utf8" });
  const names = list.stdout.trim().split("\n").sort();
  if (list.status !== 0 || JSON.stringify(names) !== JSON.stringify(expected.map(name => `package/${name}`).sort())) throw new Error("SDK archive path check failed.");
  const unpack = spawnSync("tar", ["-xzf", archive, "-C", temporary], { encoding: "utf8" });
  if (unpack.status !== 0) throw new Error("SDK archive extraction failed.");
  await checkSdkBoundary(join(temporary, "package"));
  for (const name of expected) {
    const source = await readFile(join(sdkRoot, name));
    if (!source.equals(await readFile(join(temporary, "package", name)))) throw new Error("SDK archive differs from reviewed source.");
  }
  const installed = await import(pathToFileURL(join(temporary, "package/index.js")).href);
  const transport = await checkSdkTransport(installed);
  const hash = createHash("sha256").update(await readFile(archive)).digest("hex");
  await writeFile(join(destination, "sdk-package-evidence.json"), JSON.stringify({ package: pkg.name, version: pkg.version, archive: report.filename, sha256: hash, files: actual, isolatedImportPassed: true, sourceBytesMatched: true, boundaryChecked: true, transport, fixtureOnly: true, published: false }, null, 2) + "\n");
  console.log(`Prepared ${report.filename}: 5 public SDK files; exact source bytes and all-method transport fixtures passed.`);
  console.log("No registry publication or live API request was performed.");
} finally { await rm(temporary, { recursive: true, force: true }); }
