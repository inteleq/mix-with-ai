import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, stat, symlink, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureLocal, readKeyFile } from "../scripts/setup.mjs";

const key = `mwa_test_${"x".repeat(40)}`;
async function directory(t) {
  const path = await mkdtemp(join(tmpdir(), "mwa-setup-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("live setup reads a protected key file and writes a private loopback environment", async t => {
  const path = await directory(t);
  const source = join(path, "key.json");
  await writeFile(source, JSON.stringify({ key }), { mode: 0o600 });
  assert.equal(await readKeyFile(source), key);
  await configureLocal({ directory: path, mode: "live", key: await readKeyFile(source) });
  const target = join(path, ".env");
  assert.equal((await stat(target)).mode & 0o077, 0);
  assert.match(await readFile(target, "utf8"), /^MWA_MODE=live\nMWA_API_KEY=.+\nHOST=127\.0\.0\.1\nPORT=3008\n$/);
});

test("setup refuses public or symlinked key files and leaves existing settings intact", async t => {
  const path = await directory(t), source = join(path, "key.txt");
  await writeFile(source, key, { mode: 0o644 });
  await assert.rejects(readKeyFile(source), /protected key file/);
  await chmod(source, 0o600); assert.equal(await readKeyFile(source), key);
  await symlink(source, join(path, "key-link"));
  await assert.rejects(readKeyFile(join(path, "key-link")), /protected key file/);
  await configureLocal({ directory: path, mode: "demo" });
  const previous = await readFile(join(path, ".env"), "utf8");
  await assert.rejects(configureLocal({ directory: path, mode: "live", key }), /explicit replacement/);
  assert.equal(await readFile(join(path, ".env"), "utf8"), previous);
});

test("explicit preview replacement removes the previous key and refuses an environment symlink", async t => {
  const path = await directory(t);
  await configureLocal({ directory: path, mode: "live", key });
  await configureLocal({ directory: path, mode: "demo", overwrite: true });
  assert.ok(!(await readFile(join(path, ".env"), "utf8")).includes(key));
  await rm(join(path, ".env"));
  const destination = join(path, "other"); await writeFile(destination, "keep");
  await symlink(destination, join(path, ".env"));
  await assert.rejects(configureLocal({ directory: path, mode: "demo", overwrite: true }), /non-regular/);
  assert.equal(await readFile(destination, "utf8"), "keep");
});
