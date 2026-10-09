import { lstat, open, link, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { constants } from "node:fs";

const root = fileURLToPath(new URL("../", import.meta.url));

export async function readKeyFile(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0 || info.size > 4096) {
    throw new Error("Use a regular, protected key file (chmod 600), up to 4 KB.");
  }
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  let text;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || (opened.mode & 0o077) !== 0 || opened.size > 4096) throw new Error("The key file must be protected and up to 4 KB.");
    text = (await handle.readFile("utf8")).trim();
  } finally { await handle.close(); }
  let key = text;
  if (text.startsWith("{")) {
    try { key = JSON.parse(text).key; } catch { throw new Error("The key JSON must contain a key field."); }
  }
  if (typeof key !== "string" || !/^mwa_(?:live|test)_[A-Za-z0-9_-]{32,220}$/.test(key)) {
    throw new Error("The file must contain an MWA key, as plain text or JSON with a key field.");
  }
  return key;
}

export async function configureLocal({ directory = root, mode, key, overwrite = false }) {
  if (!["demo", "live"].includes(mode)) throw new Error("Choose demo or live mode.");
  if (mode === "live" && (typeof key !== "string" || !/^mwa_(?:live|test)_[A-Za-z0-9_-]{32,220}$/.test(key))) {
    throw new Error("Live setup requires a valid MWA key format.");
  }
  const target = resolve(directory, ".env");
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("Refusing to replace a non-regular .env file.");
    if (!overwrite) throw new Error("An .env file exists. Setup needs explicit replacement confirmation.");
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  const temporary = resolve(directory, `.env.setup-${randomUUID()}`);
  try {
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(`MWA_MODE=${mode}\n${mode === "live" ? `MWA_API_KEY=${key}\n` : ""}HOST=127.0.0.1\nPORT=3008\n`); } finally { await handle.close(); }
    if (overwrite) await rename(temporary, target);
    else { await link(temporary, target); await unlink(temporary); }
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}

async function main() {
  if (!process.stdin.isTTY) throw new Error("Run npm run setup in an interactive terminal. Manual setup is in .env.example.");
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("MWA Music Starter · local setup\n1. Preview: synthesized demo, no API calls.\n2. Live: your server key and MWA API credits.\n");
    const choice = (await input.question("Choose 1 or 2 [1]: ")).trim() || "1";
    if (!["1", "2"].includes(choice)) throw new Error("Choose 1 or 2.");
    let overwrite = false;
    try {
      await lstat(resolve(root, ".env"));
      overwrite = (await input.question("Replace the existing .env with loopback-only settings? Type replace: ")).trim() === "replace";
      if (!overwrite) { console.log("Setup stopped; existing settings kept."); return; }
    } catch (error) { if (error.code !== "ENOENT") throw error; }
    const mode = choice === "1" ? "demo" : "live";
    let key;
    if (mode === "live") {
      console.log("Get an active key at https://mixwithai.com/settings/api. Save it in a protected local file.\nThe wizard reads the file without printing your key or contacting MWA.");
      const path = (await input.question("Key file path (plain text or JSON): ")).trim();
      if (!path) throw new Error("A protected key file path is required.");
      key = await readKeyFile(resolve(path));
    }
    await configureLocal({ mode, key, overwrite });
    console.log(`${mode === "live" ? "Server key configured; API access has not been verified." : "Preview configured; no key needed."}\nRun npm start, then open http://127.0.0.1:3008.\n${mode === "live" ? "Generating music uses API credits. " : ""}Keep .env out of Git.`);
  } finally { input.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { console.error("Setup could not finish. Check your mode, file permissions, and key format. No key was printed."); process.exitCode = 1; });
}
