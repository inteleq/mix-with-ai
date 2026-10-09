import { mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createRequest } from "../packages/sdk/index.js";

export const readJson = async file => JSON.parse(await readFile(file, "utf8"));
export const requestHash = input => createHash("sha256").update(JSON.stringify(createRequest(input))).digest("hex");

export async function createReceipt(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
}

export async function updateReceipt(file, value) {
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(error => { if (error.code !== "ENOENT") throw error; }); }
}
