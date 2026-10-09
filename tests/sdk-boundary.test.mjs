import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as sdk from "../packages/sdk/index.js";
import { SDK_PUBLIC_FILES, checkSdkBoundary, checkSdkTransport } from "../scripts/check-sdk-boundary.mjs";

const original = fileURLToPath(new URL("../packages/sdk/", import.meta.url));
async function copyCandidate(run) {
  const directory = await mkdtemp(join(tmpdir(), "mwa-sdk-boundary-"));
  try { await cp(original, directory, { recursive: true }); await run(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("SDK is a five-file, dependency-free public client", async () => {
  assert.deepEqual(await checkSdkBoundary(original), SDK_PUBLIC_FILES);
});

test("SDK boundary rejects dependency and install-hook additions", async () => {
  for (const field of ["dependencies", "optionalDependencies", "scripts"]) {
    await copyCandidate(async directory => {
      const path = join(directory, "package.json"), pkg = JSON.parse(await readFile(path, "utf8"));
      pkg[field] = { added: "review-required" };
      await writeFile(path, JSON.stringify(pkg));
      await assert.rejects(checkSdkBoundary(directory), /before release/);
    });
  }
});

test("SDK boundary rejects additional assets and symlinked source", async () => {
  await copyCandidate(async directory => {
    await writeFile(join(directory, "engine.js"), "export const privateEngine = true;");
    await assert.rejects(checkSdkBoundary(directory), /exactly five/);
  });
  await copyCandidate(async directory => {
    await unlink(join(directory, "index.js"));
    await symlink("README.md", join(directory, "index.js"));
    await assert.rejects(checkSdkBoundary(directory), /without symlinks/);
  });
});

test("SDK boundary requires review for code loaders, process access and additional origins", async () => {
  const moduleLoader = ["im", "port"].join("");
  for (const suffix of [`\n${moduleLoader}(source);`, "\nprocess.env.OTHER_KEY;", '\nconst endpoint = "https://unexpected.example.test";']) {
    await copyCandidate(async directory => {
      const path = join(directory, "index.js");
      await writeFile(path, await readFile(path, "utf8") + suffix);
      await assert.rejects(checkSdkBoundary(directory));
    });
  }
});

test("every SDK operation stays on public routes and signed uploads never receive the MWA key", async () => {
  assert.deepEqual(await checkSdkTransport(sdk), { calls: 11, authenticatedApiRequests: 10, signedStorageRequests: 1 });
});
