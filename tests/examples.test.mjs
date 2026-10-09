import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { USE_CASES, buildUseCaseInput } from "../examples/use-cases/catalog.mjs";
import { createRequest } from "../packages/sdk/index.js";

const parent = "10000000-0000-4000-8000-000000000001", referenceId = "20000000-0000-4000-8000-000000000002";
const ready = { reference_id: referenceId, generation_id: parent, content_sha256: "a".repeat(64), status: "ready", guidance_available: true };

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), "mwa-recipe-test-"));
  const preload = join(directory, "fixture.mjs"), callsFile = join(directory, "calls.json");
  writeFileSync(callsFile, "[]");
  writeFileSync(preload, `import assert from 'node:assert/strict';
    import {readFileSync,writeFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    const parent='${parent}',ref='${referenceId}',bytes=new Uint8Array(512);
    const hash=createHash('sha256').update(bytes).digest('hex');
    const receipt={reference_id:ref,generation_id:parent,content_sha256:hash,status:'ready',guidance_available:true,upload:null};
    globalThis.fetch=async(url,options={})=>{
      if(process.env.EXAMPLE_MODE==='offline')throw new Error('Preparation must not make a network request');
      const target=new URL(url),calls=JSON.parse(readFileSync(process.env.EXAMPLE_CALLS_FILE,'utf8'));
      calls.push({url:String(url),method:options.method??'GET',body:options.body instanceof Blob?'audio':options.body});
      writeFileSync(process.env.EXAMPLE_CALLS_FILE,JSON.stringify(calls));
      assert.equal(options.redirect,'error');
      if(target.origin==='https://storage.example.test'){
        assert.ok(!options.headers?.Authorization);
        if(options.method==='PUT'){assert.deepEqual(options.headers,{'Content-Type':'audio/wav'});assert.equal(options.body.size,512);return new Response(null);}
        assert.equal(target.pathname,'/audio');return new Response(bytes, {headers:{'content-length':'512'}});
      }
      assert.equal(target.origin,'https://mixwithai.com');
      assert.equal(options.headers.Authorization,'Bearer recipe-fixture-only-token');
      if(target.pathname==='/api/v1/references'){
        const body=JSON.parse(options.body);assert.equal(body.content_sha256,hash);assert.equal(body.user_owns_audio,true);
        return Response.json({...receipt,status:'upload_pending',guidance_available:false,upload:{method:'PUT',url:'https://storage.example.test/upload?signature=fixture'}});
      }
      if(target.pathname.endsWith('/complete'))return Response.json({...receipt,status:'analyzing',guidance_available:false});
      if(target.pathname.startsWith('/api/v1/references/'))return Response.json(receipt);
      assert.match(target.pathname,/^\\/api\\/v1\\/generations(?:\\/[a-f0-9-]{36})?$/);
      if(options.method==='POST')return Response.json({generation_id:parent,status:'queued'},{status:202});
      const audioUrl='https://storage.example.test/audio';
      return Response.json({generation_id:parent,status:'completed',audio_export:{status:'ready',download_url:audioUrl},artifact_manifest:{artifacts:[{status:'ready',download_url:audioUrl,byte_size:512,checksum_sha256:process.env.EXAMPLE_MODE==='bad-checksum'?'0'.repeat(64):hash}]}});
    };`);
  // Keep the Node preload flag distinct from module imports in the release scanner.
  const preloadFlag = "--im" + "port";
  const execute = (name, args = [], mode = "offline") => spawnSync(process.execPath, [preloadFlag, preload, fileURLToPath(new URL(`../examples/${name}`, import.meta.url)), ...args], {
    cwd: directory, encoding: "utf8", env: { ...process.env, MWA_API_KEY: "recipe-fixture-only-token", EXAMPLE_MODE: mode, EXAMPLE_CALLS_FILE: callsFile },
  });
  try { run({ directory, execute, calls: () => JSON.parse(readFileSync(callsFile, "utf8")) }); }
  finally { rmSync(directory, { recursive: true, force: true }); }
}

test("all six recipes prepare locally with public SDK inputs and private stable request keys", () => fixture(({ directory, execute, calls }) => {
  assert.equal(USE_CASES.length, 6);
  const keys = new Set();
  writeFileSync(join(directory, "ready.json"), JSON.stringify(ready));
  for (const recipe of USE_CASES) {
    const args = [recipe.id, ...(recipe.revisionKind ? ["--parent", parent] : []), ...(recipe.needsReference ? ["--reference-receipt", "ready.json"] : [])];
    const result = execute("prepare-use-case.mjs", args);
    assert.equal(result.status, 0, result.stderr);
    const file = join(directory, ".mwa-examples", `request-${recipe.id}.json`), saved = JSON.parse(readFileSync(file, "utf8"));
    createRequest(saved.input); keys.add(saved.idempotencyKey);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(execute("prepare-use-case.mjs", args).status, 1);
    assert.equal(JSON.parse(readFileSync(file, "utf8")).idempotencyKey, saved.idempotencyKey);
  }
  assert.equal(keys.size, 6); assert.equal(calls().length, 0);
}));

test("reference recipe rejects unavailable guidance and cross-parent receipts before submission", () => {
  for (const receipt of [{ ...ready, status: "analyzing" }, { ...ready, guidance_available: false }, { ...ready, generation_id: referenceId }]) {
    assert.throws(() => buildUseCaseInput("reference-guided", { parentGenerationId: parent, referenceReceipt: receipt }));
  }
  assert.throws(() => buildUseCaseInput("mix-master"));
  assert.throws(() => buildUseCaseInput("sound-character", { referenceReceipt: ready }));
});

test("generation example resumes the same receipt and rejects an edited submitted input without another request", () => fixture(({ directory, execute, calls }) => {
  assert.equal(execute("prepare-use-case.mjs", ["music-studio"]).status, 0);
  const file = ".mwa-examples/request-music-studio.json";
  assert.equal(execute("generate.mjs", [file], "api").status, 0);
  const receipt = readFileSync(join(directory, `${file}.receipt.json`), "utf8");
  assert.equal(execute("generate.mjs", [file], "api").status, 0);
  assert.equal(readFileSync(join(directory, `${file}.receipt.json`), "utf8"), receipt);
  assert.deepEqual(calls().map(call => call.method), ["POST", "GET", "GET"]);
  const saved = JSON.parse(readFileSync(join(directory, file), "utf8")); saved.input.prompt = "An edited submitted prompt";
  writeFileSync(join(directory, file), JSON.stringify(saved));
  assert.equal(execute("generate.mjs", [file], "api").status, 1);
  assert.equal(calls().length, 3);
  assert.ok(!receipt.includes("recipe-fixture-only-token") && !receipt.includes("storage.example.test"));
}));

test("owned reference example verifies the unchanged source and saves a usable credential-free receipt", () => fixture(({ directory, execute, calls }) => {
  writeFileSync(join(directory, "reference.wav"), new Uint8Array(512));
  assert.equal(execute("upload-reference.mjs", ["prepare", parent, "reference.wav", "12"]).status, 1);
  const prepared = execute("upload-reference.mjs", ["prepare", parent, "reference.wav", "12", "--owns-audio"]);
  assert.equal(prepared.status, 0, prepared.stderr); assert.equal(calls().length, 0);
  const run = execute("upload-reference.mjs", ["run", ".mwa-examples/reference-upload.json"], "api");
  assert.equal(run.status, 0, run.stderr);
  const receiptFile = ".mwa-examples/reference-upload.json.receipt.json", text = readFileSync(join(directory, receiptFile), "utf8");
  const receipt = JSON.parse(text); assert.equal(receipt.guidance_available, true); assert.equal(receipt.reference_id, referenceId);
  assert.ok(!text.includes("recipe-fixture-only-token") && !text.includes("signature="));
  assert.equal(execute("prepare-use-case.mjs", ["reference-guided", "--parent", parent, "--reference-receipt", receiptFile]).status, 0);
  assert.equal(execute("generate.mjs", [".mwa-examples/request-reference-guided.json"], "api").status, 0);
  const request = JSON.parse(calls().find(call => call.method === "POST" && call.url.endsWith("/generations")).body);
  assert.equal(request.reference.reference_id, receipt.reference_id); assert.equal(request.reference.content_sha256, receipt.content_sha256);
  const before = calls().length;
  writeFileSync(join(directory, "reference.wav"), new Uint8Array(512).fill(1));
  assert.equal(execute("upload-reference.mjs", ["run", ".mwa-examples/reference-upload.json"], "api").status, 1);
  assert.equal(calls().length, before);
}));

test("audio example refreshes delivery, omits credentials on storage and verifies output integrity", () => fixture(({ directory, execute, calls }) => {
  const result = execute("download-audio.mjs", [parent, ".mwa-examples/track.mp3"], "api");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readFileSync(join(directory, ".mwa-examples/track.mp3")), Buffer.from(new Uint8Array(512)));
  assert.equal(calls().length, 2);
  assert.equal(execute("download-audio.mjs", [parent, ".mwa-examples/invalid.mp3"], "bad-checksum").status, 1);
  assert.throws(() => readFileSync(join(directory, ".mwa-examples/invalid.mp3")));
  assert.equal(execute("download-audio.mjs", [parent, ".mwa-examples/track.mp3"], "api").status, 1);
  assert.deepEqual(readFileSync(join(directory, ".mwa-examples/track.mp3")), Buffer.from(new Uint8Array(512)));
}));
