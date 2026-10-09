import test from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { MwaClient, MwaApiError, createRequest } from "../packages/sdk/index.js";

const id = "10000000-0000-4000-8000-000000000001";
const input = { prompt: "Warm house with gentle percussion", genre: "deep_house" };
const accepted = { generation_id: id, status: "queued" };
const response = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const client = fetch => new MwaClient({ apiKey: "test-only-token", fetch });

test("reference guidance preserves the supported modes without accepting audio or private evidence", async () => {
  const bodies = [];
  const mwa = client(async (_url, options) => { bodies.push(JSON.parse(options.body)); return response(accepted, 202); });
  for (const mode of ["auto", "off"]) {
    await mwa.generate({ ...input, referenceGuidance: { mode } }, { idempotencyKey: `guidance-${mode}` });
    assert.deepEqual(bodies.at(-1).referenceGuidance, { mode });
  }
  assert.ok(!Object.hasOwn(createRequest(input), "referenceGuidance"));
  for (const referenceGuidance of [null, {}, [], { mode: "upload" }, { mode: "auto", audio_url: "https://example.com/track.mp3" }, { mode: "off", reference_id: id }]) {
    assert.throws(() => mwa.generate({ ...input, referenceGuidance }, { idempotencyKey: "invalid-guidance" }), TypeError);
  }
  assert.equal(bodies.length, 2);
});

test("submission uses only the public origin, versioned request and caller idempotency key", async () => {
  let seen;
  const mwa = client(async (url, options) => { seen = { url, options }; return response(accepted, 202); });
  await mwa.generate(input, { idempotencyKey: "stable-request-key" });
  assert.equal(seen.url, "https://mixwithai.com/api/v1/generations");
  assert.equal(seen.options.headers.Authorization, "Bearer test-only-token");
  assert.equal(seen.options.headers["Idempotency-Key"], "stable-request-key");
  assert.equal(seen.options.redirect, "error");
  const body = JSON.parse(seen.options.body);
  assert.equal(body.model, "mwa-edm-v1"); assert.equal(body.duration_seconds, 180);
  assert.deepEqual(body.outputs, { project_json: true, preview_audio: true, master_audio: true, stems: "none", midi: false, presets: false });
  assert.ok(!inspect(mwa).includes("test-only-token"));
});

test("invalid requests fail before network calls", () => {
  let calls = 0; const mwa = client(() => { calls++; });
  for (const bad of [{ ...input, genre: "jazz" }, { ...input, prompt: "💿".repeat(400) }, { ...input, user_id: "someone" }, { ...input, revision: { parent_generation_id: "../private", kind: "remix" } }]) {
    assert.throws(() => mwa.generate(bad, { idempotencyKey: "valid-key" }), TypeError);
  }
  assert.throws(() => mwa.generate(input), TypeError);
  assert.throws(() => mwa.get("../../admin"), TypeError);
  assert.equal(calls, 0);
});

test("client rejects unsafe authenticated origins", () => {
  for (const baseUrl of ["http://example.com", "https://user:password@example.com", "https://example.com/api", "https://example.com?x=1"]) {
    assert.throws(() => new MwaClient({ apiKey: "test", baseUrl }), TypeError);
  }
});

test("network failure never automatically repeats a paid submission", async () => {
  let calls = 0;
  const mwa = client(async () => { calls++; throw new Error("connection interrupted"); });
  await assert.rejects(mwa.generate(input, { idempotencyKey: "same-request" }), error => error instanceof MwaApiError && error.retryable && error.status === 0);
  assert.equal(calls, 1);
});

test("API errors retain retry guidance and redact an echoed key", async () => {
  const mwa = client(async () => response({ error: { code: "rate_limited", message: "Wait test-only-token", request_id: "request-1" } }, 429, { "Retry-After": "2" }));
  await assert.rejects(mwa.get(id), error => error.status === 429 && error.retryAfterMs === 2000 && error.requestId === "request-1" && !error.message.includes("test-only-token"));
});

test("waiting survives rate limits and waits for the audio export after project completion", async () => {
  let calls = 0;
  const statuses = [response({ error: { message: "Slow down" } }, 429, { "Retry-After": "0.01" }), response({ ...accepted, status: "completed", audio_export: { status: "processing" } }), response({ ...accepted, status: "completed", audio_export: { status: "ready" } })];
  const mwa = client(async () => statuses[calls++]);
  const observed = [];
  const final = await mwa.wait(id, { pollIntervalMs: 10, timeoutMs: 1000, onProgress: job => observed.push(job.audio_export.status) });
  assert.equal(calls, 3); assert.equal(final.audio_export.status, "ready"); assert.deepEqual(observed, ["processing", "ready"]);
});

test("failed and cancelled jobs are terminal even with stale delivery metadata", async () => {
  for (const status of ["failed", "cancelled"]) {
    const mwa = client(async () => response({ ...accepted, status, audio_export: { status: "processing" } }));
    assert.equal((await mwa.wait(id, { pollIntervalMs: 10 })).status, status);
  }
});

test("export retry acknowledges then reads status using the same generation", async () => {
  const calls = [];
  const mwa = client(async (url, options) => { calls.push([url, options]); return response(calls.length === 1 ? { accepted: true } : { ...accepted, status: "completed", audio_export: { status: "processing" } }, calls.length === 1 ? 202 : 200); });
  const job = await mwa.retryExport(id, { idempotencyKey: "export-retry-key" });
  assert.equal(calls[0][0], `https://mixwithai.com/api/v1/generations/${id}/retry-export`);
  assert.equal(calls[0][1].headers["Idempotency-Key"], "export-retry-key");
  assert.equal(calls[1][1].method, "GET"); assert.equal(job.audio_export.status, "processing");
});

test("aborting a wait sends no cancellation request", async () => {
  const controller = new AbortController(); const urls = [];
  const mwa = client(async url => { urls.push(url); return response(accepted); });
  await assert.rejects(mwa.wait(id, { pollIntervalMs: 10, signal: controller.signal, onProgress: () => controller.abort() }), error => error.name === "AbortError");
  assert.equal(urls.length, 1); assert.ok(!urls[0].endsWith("/cancel"));
});

test("request builder preserves only the intentional revision fields", () => {
  const request = createRequest({ ...input, title: "  A new version  ", revision: { parent_generation_id: id, kind: "variation" } });
  assert.equal(request.title, "A new version");
  assert.deepEqual(request.revision, { parent_generation_id: id, kind: "variation" });
});

test("export recovery waits for audio without changing the original failed audit status", async () => {
  let calls = 0;
  const mwa = client(async () => response({ ...accepted, status: "failed", audio_export: { status: ++calls === 1 ? "processing" : "ready" } }));
  const result = await mwa.wait(id, { waitForAudio: true, pollIntervalMs: 10, timeoutMs: 1000 });
  assert.equal(calls, 2); assert.equal(result.status, "failed"); assert.equal(result.audio_export.status, "ready");
});

test("cancellation remains terminal during an explicit audio wait", async () => {
  const mwa = client(async () => response({ ...accepted, status: "cancelled", audio_export: { status: "processing" } }));
  assert.equal((await mwa.wait(id, { waitForAudio: true })).status, "cancelled");
});

test("a status response for a different generation is rejected", async () => {
  const mwa = client(async () => response({ ...accepted, generation_id: "10000000-0000-4000-8000-000000000002" }));
  await assert.rejects(mwa.get(id), error => error instanceof MwaApiError && error.code === "invalid_response");
});

test("generation identity validation accepts the same UUID with different letter case", async () => {
  const generationId = "abcde000-0000-4000-8000-000000000001";
  const client = new MwaClient({ apiKey: "test-only-token", fetch: async () => Response.json({ generation_id: generationId, status: "completed" }) });
  assert.equal((await client.get(generationId.toUpperCase())).generation_id, generationId);
});

const referenceReceipt = { schema_version: "reference_response_v1", object: "music_reference", reference_id: id, generation_id: id,
  filename: "reference.wav", content_sha256: "a".repeat(64), byte_size: 512, duration_seconds: 12, status: "upload_pending", guidance_available: false,
  status_url: `/api/v1/references/${id}`, error: null, upload: { method: "PUT", url: "https://storage.example.test/signed-upload", expires_at: "2030-01-01T00:00:00.000Z", content_type: "audio/wav", max_bytes: 50*1024*1024 } };

test("reference transfer sends no API key to storage and completion has a durable reference identity", async () => {
  const calls=[];
  const mwa=client(async(url,options)=>{
    calls.push([url,options]);
    if(url.startsWith("https://storage.example.test")) { assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,"error");assert.equal(options.method,"PUT");return new Response(null,{status:200}); }
    return response(url.endsWith("/complete")?{...referenceReceipt,status:"analyzing",upload:null}:referenceReceipt);
  });
  const result=await mwa.uploadReference(id,new Blob([new Uint8Array(512)],{type:"audio/wav"}),{filename:"reference.wav",durationSeconds:12,userOwnsAudio:true,idempotencyKey:"saved-upload-request"});
  assert.equal(result.status,"analyzing");assert.equal(calls.length,3);
  const input=JSON.parse(calls[0][1].body);assert.match(input.content_sha256,/^[a-f0-9]{64}$/);assert.equal(input.byte_size,512);
  assert.equal(calls[2][0],`https://mixwithai.com/api/v1/references/${id}/complete`);
});

test("reference upload rejects unsafe metadata and storage authorities before a transfer", async () => {
  const metadata={generation_id:id,filename:"reference.wav",byte_size:512,duration_seconds:12,content_type:"audio/wav",content_sha256:"a".repeat(64),user_owns_audio:true};
  let calls=0;const mwa=client(async()=>{calls++;return response({...referenceReceipt,upload:{...referenceReceipt.upload,url:"http://unsafe.example/upload"}});});
  for(const value of [{...metadata,user_id:"someone"},{...metadata,user_owns_audio:false},{...metadata,filename:"../reference.wav"},{...metadata,byte_size:51*1024*1024}])
    assert.throws(()=>mwa.prepareReferenceUpload(value,{idempotencyKey:"saved-upload-request"}),TypeError);
  assert.equal(calls,0);
  await assert.rejects(mwa.uploadReference(id,new Blob([new Uint8Array(512)]),{filename:"reference.wav",durationSeconds:12,userOwnsAudio:true,idempotencyKey:"saved-upload-request"}),error=>error.code==="invalid_response");
  assert.equal(calls,1);
});

test("ready reference replay transfers no bytes and does not requeue analysis", async () => {
  let calls=0;const mwa=client(async()=>{calls++;return response({...referenceReceipt,status:"ready",guidance_available:true,upload:null});});
  const receipt=await mwa.uploadReference(id,new Blob([new Uint8Array(512)]),{filename:"reference.wav",durationSeconds:12,userOwnsAudio:true,idempotencyKey:"saved-upload-request"});
  assert.equal(receipt.status,"ready");assert.equal(calls,1);
});

test("pinned reference requests require revisions, bind the source hash and enable automatic guidance", () => {
  const reference={reference_id:id,content_sha256:"a".repeat(64)};
  assert.throws(()=>createRequest({...input,reference}),TypeError);
  assert.throws(()=>createRequest({...input,reference,revision:{parent_generation_id:id,kind:"variation"},referenceGuidance:{mode:"off"}}),TypeError);
  const body=createRequest({...input,reference,revision:{parent_generation_id:id,kind:"variation"}});
  assert.deepEqual(body.reference,reference);assert.deepEqual(body.referenceGuidance,{mode:"auto"});
});

test("reference polling backs off on rate limits and returns failure states for the caller to inspect", async () => {
  const statuses=[response({error:{code:"rate_limited",message:"Wait"}},429,{"Retry-After":"0.01"}),response({...referenceReceipt,status:"analyzing"}),response({...referenceReceipt,status:"failed"})];
  let calls=0;const mwa=client(async()=>statuses[calls++]);
  assert.equal((await mwa.waitForReference(id,{pollIntervalMs:10,timeoutMs:1000})).status,"failed");assert.equal(calls,3);
});
