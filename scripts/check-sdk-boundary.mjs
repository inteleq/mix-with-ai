import assert from "node:assert/strict";
import { lstat, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const SDK_PUBLIC_FILES = Object.freeze(["LICENSE", "README.md", "index.d.ts", "index.js", "package.json"]);

/** Conservative release guard; source review and fixtures remain necessary. */
export async function checkSdkBoundary(directory) {
  assert.deepEqual((await readdir(directory)).sort(), SDK_PUBLIC_FILES, "SDK must contain exactly five public files.");
  const contents = {};
  for (const name of SDK_PUBLIC_FILES) {
    const info = await lstat(join(directory, name));
    assert.ok(info.isFile() && !info.isSymbolicLink(), "SDK files must be regular files, without symlinks.");
    contents[name] = await readFile(join(directory, name), "utf8");
    assert.doesNotMatch(contents[name], /mwa_(?:live|test)_[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\/(?:Users|home)\/[A-Za-z0-9_.-]+\//, "SDK contains credential or local-path patterns.");
  }
  const pkg = JSON.parse(contents["package.json"]);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "bundledDependencies", "scripts", "bin"]) {
    assert.equal(Object.keys(pkg[field] ?? {}).length, 0, `Review SDK ${field} before release.`);
  }
  assert.deepEqual(pkg.files.slice().sort(), SDK_PUBLIC_FILES.filter(name => name !== "package.json"));
  assert.equal(pkg.type, "module");
  assert.equal(pkg.main, "./index.js");
  assert.equal(pkg.types, "./index.d.ts");
  assert.deepEqual(pkg.exports, { ".": { types: "./index.d.ts", import: "./index.js" } });
  for (const name of ["index.js", "index.d.ts"]) {
    // The current dependency-free client needs no module loaders or process access.
    assert.doesNotMatch(contents[name], /\b(?:import|require|eval|Function|process|Deno|Bun|WebSocket|XMLHttpRequest|navigator)\b/, "SDK loaders or additional I/O require review.");
    assert.doesNotMatch(contents[name], /@\/|(?:\.\.\/){2}|supabase|runpod|clerk|server-only|service_role|PRIVATE_KEY/i, "SDK contains private implementation patterns.");
  }
  assert.deepEqual([...contents["index.js"].matchAll(/https?:\/\/[A-Za-z0-9._:-]+/g)].map(match => match[0]), ["https://mixwithai.com"], "Review additional SDK network origins.");
  return SDK_PUBLIC_FILES;
}

/** Offline HTTP fixture: checks every client operation, including signed transfer. */
export async function checkSdkTransport(sdk) {
  const generationId = "10000000-0000-4000-8000-000000000001";
  const referenceId = "20000000-0000-4000-8000-000000000002";
  const token = "package-fixture-only-token";
  const audio = new Blob([new Uint8Array(512)], { type: "audio/wav" });
  const digest = createHash("sha256").update(new Uint8Array(await audio.arrayBuffer())).digest("hex");
  const calls = [];
  const generation = { generation_id: generationId, status: "completed", audio_export: { status: "ready", download_url: "https://storage.example.test/output.mp3" } };
  const reference = { reference_id: referenceId, generation_id: generationId, content_sha256: digest, status: "ready", guidance_available: true, upload: null };
  const client = new sdk.MwaClient({ apiKey: token, fetch: async (url, options) => {
    const target = new URL(url);
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    calls.push(`${options.method} ${target.pathname}`);
    if (target.origin === "https://storage.example.test") {
      assert.equal(target.pathname, "/signed-reference");
      assert.equal(options.method, "PUT");
      assert.deepEqual(options.headers, { "Content-Type": "audio/wav" });
      assert.equal(options.body, audio);
      assert.ok(!JSON.stringify(options).includes(token));
      return new Response(null, { status: 200 });
    }
    assert.equal(target.origin, "https://mixwithai.com");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.match(target.pathname, /^\/api\/v1\/(?:generations|references)(?:\/[a-f0-9-]{36}(?:\/(?:cancel|retry-export|complete))?)?$/);
    if (target.pathname === "/api/v1/references" && options.method === "POST") {
      assert.equal(JSON.parse(options.body).content_sha256, digest);
      assert.equal(options.headers["Idempotency-Key"], "package-upload-key");
      return Response.json({ ...reference, status: "upload_pending", guidance_available: false, upload: { method: "PUT", url: "https://storage.example.test/signed-reference?token=fixture", content_type: "audio/wav" } });
    }
    if (target.pathname.startsWith("/api/v1/references/")) return Response.json(reference);
    if (target.pathname.endsWith("/retry-export")) return Response.json({ accepted: true }, { status: 202 });
    if (options.method === "POST" && target.pathname === "/api/v1/generations") {
      assert.equal(JSON.parse(options.body).model, "mwa-edm-v1");
      return Response.json({ ...generation, status: "queued" }, { status: 202 });
    }
    return Response.json(generation);
  } });
  const job = await client.generate({ prompt: "Instrumental deep house", genre: "deep_house" }, { idempotencyKey: "package-generation-key" });
  await client.wait(job.generation_id);
  await client.cancel(generationId);
  await client.retryExport(generationId, { idempotencyKey: "package-export-key" });
  const uploaded = await client.uploadReference(generationId, audio, { filename: "reference.wav", durationSeconds: 12, userOwnsAudio: true, idempotencyKey: "package-upload-key" });
  const ready = await client.waitForReference(uploaded.reference_id);
  assert.equal(ready.guidance_available, true);
  await client.generate({ prompt: "Use my reference for energy", genre: "deep_house", revision: { parent_generation_id: generationId, kind: "variation" }, reference: { reference_id: ready.reference_id, content_sha256: ready.content_sha256 } }, { idempotencyKey: "package-revision-key" });
  await client.removeReference(referenceId);
  assert.deepEqual(calls, [
    "POST /api/v1/generations", `GET /api/v1/generations/${generationId}`, `POST /api/v1/generations/${generationId}/cancel`,
    `POST /api/v1/generations/${generationId}/retry-export`, `GET /api/v1/generations/${generationId}`,
    "POST /api/v1/references", "PUT /signed-reference", `POST /api/v1/references/${referenceId}/complete`,
    `GET /api/v1/references/${referenceId}`, "POST /api/v1/generations", `DELETE /api/v1/references/${referenceId}`,
  ], "Unexpected SDK request or automatic artifact download.");
  return { calls: calls.length, authenticatedApiRequests: 10, signedStorageRequests: 1 };
}
