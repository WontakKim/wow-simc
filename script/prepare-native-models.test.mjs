import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MODEL_ACTORS, prepareNativeModels, resolveModelDependencies } from "./prepare-native-models.mjs";

function chunk(tag, payload) {
  const bytes = new Uint8Array(8 + payload.byteLength);
  bytes.set(new TextEncoder().encode(tag), 0);
  new DataView(bytes.buffer).setUint32(4, payload.byteLength, true);
  bytes.set(payload instanceof Uint8Array ? payload : new Uint8Array(payload), 8);
  return bytes;
}

function u32s(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

function afidEntries(entries) {
  const bytes = new Uint8Array(entries.length * 8);
  const view = new DataView(bytes.buffer);
  entries.forEach(([animationId, variationIndex, fileDataId], index) => {
    view.setUint16(index * 8, animationId, true);
    view.setUint16(index * 8 + 2, variationIndex, true);
    view.setUint32(index * 8 + 4, fileDataId, true);
  });
  return bytes;
}

function assemble(chunks) {
  const total = chunks.reduce((sum, entry) => sum + entry.length, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const entry of chunks) {
    file.set(entry, offset);
    offset += entry.length;
  }
  return file;
}

/** Minimal MD21-container model with only the fields the resolver reads. */
function makeModelFile({ viewCount = 1, sequences = [], sfid = [], txid = [], afid = [], skid = 0 } = {}) {
  const payload = new Uint8Array(0x400);
  const view = new DataView(payload.buffer);
  view.setUint32(0, 0x3032444d, true); // "MD20"
  view.setUint32(4, 274, true);
  view.setUint32(0x1c, sequences.length, true);
  view.setUint32(0x20, 0x200, true);
  sequences.forEach((sequence, index) => {
    const at = 0x200 + index * 0x40;
    view.setUint16(at, sequence.animationId, true);
    view.setUint16(at + 2, sequence.variationIndex ?? 0, true);
    view.setUint32(at + 0xc, sequence.flags ?? 0x20, true);
  });
  view.setUint32(0x44, viewCount, true);
  const chunks = [chunk("MD21", payload), chunk("SFID", u32s(sfid)), chunk("TXID", u32s(txid))];
  if (afid.length) chunks.push(chunk("AFID", afidEntries(afid)));
  if (skid) chunks.push(chunk("SKID", u32s([skid])));
  return assemble(chunks);
}

/** Minimal SKEL with SKS1 sequences/AFID and a SKPD parent id. */
function makeSkelFile({ parent = 0, sequences = [], afid = [] } = {}) {
  const sks1 = new Uint8Array(0x200);
  const view = new DataView(sks1.buffer);
  view.setUint32(8, sequences.length, true);
  view.setUint32(12, 0x100, true);
  sequences.forEach((sequence, index) => {
    const at = 0x100 + index * 0x40;
    view.setUint16(at, sequence.animationId, true);
    view.setUint16(at + 2, sequence.variationIndex ?? 0, true);
    view.setUint32(at + 0xc, sequence.flags ?? 0x20, true);
  });
  const skb1 = new Uint8Array(8);
  const chunks = [chunk("SKS1", sks1), chunk("SKB1", skb1), chunk("SKPD", u32s([parent]))];
  if (afid.length) chunks.push(chunk("AFID", afidEntries(afid)));
  return assemble(chunks);
}

function makeBlp() {
  const bytes = new Uint8Array(156);
  bytes.set(new TextEncoder().encode("BLP2"), 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, 1, true);
  view.setUint8(8, 2);
  view.setUint32(12, 4, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, 148, true);
  view.setUint32(84, 8, true);
  return bytes;
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

const stubFetch = (files) => {
  const requested = [];
  const implementation = async (fileDataId) => {
    requested.push(fileDataId);
    if (!files.has(fileDataId)) throw new Error(`unexpected FileDataID ${fileDataId}`);
    return files.get(fileDataId);
  };
  implementation.requested = requested;
  return implementation;
};

test("resolver reaches a fixed point across skins, textures and the SKPD parent chain", async () => {
  const model = makeModelFile({ viewCount: 2, sfid: [11, 12, 13], txid: [0, 21], skid: 31 });
  const fetchFileData = stubFetch(new Map([
    [31, makeSkelFile({ parent: 32 })],
    [32, makeSkelFile({ parent: 0 })],
  ]));

  const dependencies = await resolveModelDependencies(model, [0], fetchFileData);

  assert.deepEqual([...dependencies.entries()].sort((a, b) => a[0] - b[0]), [
    [11, "skin"], [12, "skin"], [21, "blp"], [31, "skel"], [32, "skel"],
  ]);
  assert.ok(!fetchFileData.requested.includes(0), "FileDataID 0 must never be fetched");
  assert.ok(!fetchFileData.requested.includes(13), "entries beyond viewCount are LODs and must be skipped");
});

test("resolver rejects a SKEL parent cycle", async () => {
  const model = makeModelFile({ skid: 31 });
  const fetchFileData = stubFetch(new Map([
    [31, makeSkelFile({ parent: 32 })],
    [32, makeSkelFile({ parent: 31 })],
  ]));
  await assert.rejects(resolveModelDependencies(model, [], fetchFileData), /SKEL.*cycle/i);
});

test("resolver collects external .anim files for wanted sequences and skips FileDataID 0", async () => {
  const model = makeModelFile({
    sequences: [
      { animationId: 0, flags: 0x20 },
      { animationId: 9, variationIndex: 0, flags: 0 },
      { animationId: 9, variationIndex: 1, flags: 0 },
    ],
    afid: [[9, 0, 41], [9, 1, 0]],
  });
  const fetchFileData = stubFetch(new Map());

  const dependencies = await resolveModelDependencies(model, [0, 9], fetchFileData);

  assert.deepEqual([...dependencies.entries()], [[41, "anim"]]);
  assert.ok(!fetchFileData.requested.includes(0));
});

test("resolver sources animation data from the linked skeleton's sequences and AFID", async () => {
  const model = makeModelFile({
    skid: 31,
    sequences: [{ animationId: 9, flags: 0x20 }],
  });
  const fetchFileData = stubFetch(new Map([
    [31, makeSkelFile({ sequences: [{ animationId: 9, flags: 0 }], afid: [[9, 0, 51]] })],
  ]));

  const dependencies = await resolveModelDependencies(model, [9], fetchFileData);

  assert.deepEqual([...dependencies.entries()].sort((a, b) => a[0] - b[0]), [[31, "skel"], [51, "anim"]]);
});

async function withWorkspace(run) {
  const root = await mkdtemp(join(tmpdir(), "native-model-test-"));
  try {
    await run({ outputDirectory: join(root, "models"), manifestPath: join(root, "manifest.json") });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const testActor = { name: "fixture-actor", modelFileDataId: 101, animationIds: [0] };

function fixtureLibrary() {
  return new Map([
    [101, makeModelFile({ sequences: [{ animationId: 0, flags: 0x20 }], sfid: [111], txid: [121] })],
    [111, chunk("SKIN", new Uint8Array(0x40))],
    [121, makeBlp()],
  ]);
}

const config = { attempts: 1, timeoutMs: 1_000 };

test("prepareNativeModels downloads, validates and pins the full closure, then writes the manifest", () => withWorkspace(async ({ outputDirectory, manifestPath }) => {
  const library = fixtureLibrary();
  await prepareNativeModels({
    ...config,
    actors: [testActor],
    outputDirectory,
    manifestPath,
    fetchFileData: stubFetch(library),
  });

  assert.deepEqual((await readdir(outputDirectory)).sort(), ["101.m2", "111.skin", "121.blp"]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.build, "12.1.0.69933");
  assert.deepEqual(manifest.actors, [testActor]);
  assert.deepEqual(manifest.assets, [...library.entries()].sort((a, b) => a[0] - b[0]).map(([fileDataId, bytes]) => ({
    fileDataId,
    kind: fileDataId === 101 ? "m2" : fileDataId === 111 ? "skin" : "blp",
    byteSize: bytes.length,
    sha256: sha256(bytes),
  })));
}));

test("a second run verifies local files against the manifest without any fetch", () => withWorkspace(async ({ outputDirectory, manifestPath }) => {
  await prepareNativeModels({
    ...config,
    actors: [testActor],
    outputDirectory,
    manifestPath,
    fetchFileData: stubFetch(fixtureLibrary()),
  });

  await prepareNativeModels({
    ...config,
    actors: [testActor],
    outputDirectory,
    manifestPath,
    fetchFileData: async () => {
      throw new Error("the network must not be touched while the manifest verifies");
    },
  });
}));

test("rejects bytes whose SHA-256 does not match the pinned manifest", () => withWorkspace(async ({ outputDirectory, manifestPath }) => {
  const library = fixtureLibrary();
  const modelBytes = library.get(101);
  await writeFile(manifestPath, JSON.stringify({
    build: "12.1.0.69933",
    assets: [{
      fileDataId: 101, kind: "m2", byteSize: modelBytes.length, sha256: "0".repeat(64),
    }],
  }));

  await assert.rejects(prepareNativeModels({
    ...config,
    actors: [testActor],
    outputDirectory,
    manifestPath,
    fetchFileData: stubFetch(library),
  }), /FileDataID 101.*SHA-256 mismatch/i);
  assert.deepEqual(await readdir(outputDirectory), []);
}));

test("rejects a malformed manifest", () => withWorkspace(async ({ outputDirectory, manifestPath }) => {
  await writeFile(manifestPath, JSON.stringify({ build: "12.1.0.69933", assets: "nope" }));
  await assert.rejects(prepareNativeModels({
    ...config,
    actors: [testActor],
    outputDirectory,
    manifestPath,
    fetchFileData: stubFetch(fixtureLibrary()),
  }), /manifest/i);
}));

test("reports drift when the resolved closure exceeds the pinned manifest", () => withWorkspace(async ({ outputDirectory, manifestPath }) => {
  const library = fixtureLibrary();
  const modelBytes = library.get(101);
  await writeFile(manifestPath, JSON.stringify({
    build: "12.1.0.69933",
    assets: [{
      fileDataId: 101, kind: "m2", byteSize: modelBytes.length, sha256: sha256(modelBytes),
    }],
  }));

  await assert.rejects(prepareNativeModels({
    ...config,
    actors: [testActor],
    outputDirectory,
    manifestPath,
    fetchFileData: stubFetch(library),
  }), /drift|not.*pinned/i);
}));

test("MODEL_ACTORS pins both replay actors with their animation ids", () => {
  assert.deepEqual(MODEL_ACTORS.map((actor) => actor.modelFileDataId), [125259, 1890761]);
  const vulpera = MODEL_ACTORS.find((actor) => actor.modelFileDataId === 1890761);
  assert.deepEqual(vulpera.animationIds, [0, 51, 52, 53, 54, 124, 125, 828, 830, 862, 1122, 1148, 1448]);
  const dummy = MODEL_ACTORS.find((actor) => actor.modelFileDataId === 125259);
  assert.deepEqual(dummy.animationIds, [0, 9, 10]);
});
