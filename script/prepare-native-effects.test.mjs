import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { prepareNativeEffects } from "./prepare-native-effects.mjs";

function makeBc1Blp() {
  const bytes = new Uint8Array(156);
  bytes.set(new TextEncoder().encode("BLP2"));
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint8(8, 2);
  view.setUint8(9, 0);
  view.setUint8(10, 0);
  view.setUint8(11, 0);
  view.setUint32(12, 4, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, 148, true);
  view.setUint32(84, 8, true);
  return bytes;
}

function manifest(bytes, overrides = {}) {
  return {
    fileDataId: 1,
    extension: "blp",
    byteSize: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    ...overrides,
  };
}

async function withOutputDirectory(run) {
  const outputDirectory = await mkdtemp(join(tmpdir(), "native-effect-test-"));
  try {
    await run(outputDirectory);
  } finally {
    await rm(outputDirectory, { recursive: true, force: true });
  }
}

const oneAttempt = { attempts: 1, timeoutMs: 1_000, baseUrl: "https://example.invalid/api/casc" };

test("promotes a complete validated download", () => withOutputDirectory(async (outputDirectory) => {
  const bytes = makeBc1Blp();
  await prepareNativeEffects({
    ...oneAttempt,
    assets: [manifest(bytes)],
    outputDirectory,
    fetchImplementation: async () => new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } }),
  });
  assert.deepEqual(new Uint8Array(await readFile(join(outputDirectory, "1.blp"))), bytes);
  assert.deepEqual(await readdir(outputDirectory), ["1.blp"]);
}));

test("fails visibly when the source is missing", () => withOutputDirectory(async (outputDirectory) => {
  const bytes = makeBc1Blp();
  await assert.rejects(
    prepareNativeEffects({
      ...oneAttempt,
      assets: [manifest(bytes, { fileDataId: 2 })],
      outputDirectory,
      fetchImplementation: async () => new Response("missing", { status: 404 }),
    }),
    /FileDataID 2.*download failed.*HTTP 404/i,
  );
  assert.deepEqual(await readdir(outputDirectory), []);
}));

test("rejects hash mismatch and partial downloads without promotion", async (context) => {
  await context.test("hash mismatch", () => withOutputDirectory(async (outputDirectory) => {
    const bytes = makeBc1Blp();
    await assert.rejects(
      prepareNativeEffects({
        ...oneAttempt,
        assets: [manifest(bytes, { fileDataId: 3, sha256: "0".repeat(64) })],
        outputDirectory,
        fetchImplementation: async () => new Response(bytes),
      }),
      /FileDataID 3.*SHA-256 mismatch/i,
    );
    assert.deepEqual(await readdir(outputDirectory), []);
  }));

  await context.test("partial body", () => withOutputDirectory(async (outputDirectory) => {
    const bytes = makeBc1Blp();
    const partial = bytes.slice(0, -1);
    await assert.rejects(
      prepareNativeEffects({
        ...oneAttempt,
        assets: [manifest(bytes, { fileDataId: 4 })],
        outputDirectory,
        fetchImplementation: async () => new Response(partial),
      }),
      /FileDataID 4.*expected 156 bytes.*155.*partial/i,
    );
    assert.deepEqual(await readdir(outputDirectory), []);
  }));
});

test("rejects invalid magic even when size and hash match", () => withOutputDirectory(async (outputDirectory) => {
  const bytes = makeBc1Blp();
  bytes.set(new TextEncoder().encode("NOPE"));
  await assert.rejects(
    prepareNativeEffects({
      ...oneAttempt,
      assets: [manifest(bytes, { fileDataId: 5 })],
      outputDirectory,
      fetchImplementation: async () => new Response(bytes),
    }),
    /FileDataID 5.*BLP2 header/i,
  );
  assert.deepEqual(await readdir(outputDirectory), []);
}));


test("stops consuming a chunked response when it exceeds the pinned byte size", () => withOutputDirectory(async (outputDirectory) => {
  const bytes = makeBc1Blp();
  let pullCount = 0;
  const body = new ReadableStream({
    pull(controller) {
      pullCount += 1;
      if (pullCount > 20) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(100));
    },
  });
  await assert.rejects(
    prepareNativeEffects({
      ...oneAttempt,
      assets: [manifest(bytes, { fileDataId: 6 })],
      outputDirectory,
      fetchImplementation: async () => new Response(body),
    }),
    /FileDataID 6.*exceeds.*156 bytes/i,
  );
  assert.ok(pullCount <= 3, `stream pulled ${pullCount} chunks after exceeding its bound`);
  assert.deepEqual(await readdir(outputDirectory), []);
}));

test("does not compare compressed transfer length with decoded body length", () => withOutputDirectory(async (outputDirectory) => {
  const bytes = makeBc1Blp();
  await prepareNativeEffects({
    ...oneAttempt,
    assets: [manifest(bytes, { fileDataId: 7 })],
    outputDirectory,
    fetchImplementation: async () => new Response(bytes, {
      headers: { "content-encoding": "gzip", "content-length": "42" },
    }),
  });
  assert.deepEqual(new Uint8Array(await readFile(join(outputDirectory, "7.blp"))), bytes);
}));

test("preserves a pre-existing process-named temp path", () => withOutputDirectory(async (outputDirectory) => {
  const bytes = makeBc1Blp();
  const collision = join(outputDirectory, `8.blp.tmp-${process.pid}`);
  const sentinel = new TextEncoder().encode("owned by another process");
  await writeFile(collision, sentinel);

  await prepareNativeEffects({
    ...oneAttempt,
    assets: [manifest(bytes, { fileDataId: 8 })],
    outputDirectory,
    fetchImplementation: async () => new Response(bytes),
  });

  assert.deepEqual(new Uint8Array(await readFile(join(outputDirectory, "8.blp"))), bytes);
  assert.deepEqual(new Uint8Array(await readFile(collision)), sentinel);
}));
