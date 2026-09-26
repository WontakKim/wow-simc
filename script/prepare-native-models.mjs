#!/usr/bin/env node
// Prepares the native M2 actor models (Training Dummy, Vulpera male) for the
// browser viewer: resolves each model's dependency closure (LOD0 skins, non-zero
// TXID textures, the SKEL chain, external .anim files for the replay animation
// ids), downloads the bytes from CASC-by-FileDataID, validates them, writes them
// to the ignored web/public/model/native-models directory and pins the closure
// in the tracked manifest web/src/nativeModelManifest.json.
//
// The resolver's byte parsing is a minimal, independent reader (the web/src/m2
// module is TypeScript and not importable from Node scripts); the semantics
// mirror the M2 format research doc and the wow.export dependency resolution.

import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD = "12.1.0.69933";
const DEFAULT_BASE_URL = "https://wago.tools/api/casc";
const MAX_DOWNLOAD_BYTES = 64 * 1024 * 1024;
const MAX_ARRAY_COUNT = 1_000_000;
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, "web/public/model/native-models");
const DEFAULT_MANIFEST_PATH = join(REPOSITORY_ROOT, "web/src/nativeModelManifest.json");

export const MODEL_ACTORS = [
  // Training Dummy: Stand, CombatWound, CombatCritical (hit reactions).
  { name: "training-dummy", modelFileDataId: 125259, animationIds: [0, 9, 10] },
  // Vulpera male: cast/channel idles plus the clips mapped in web/src/replay.ts.
  {
    name: "vulpera-male",
    modelFileDataId: 1890761,
    animationIds: [0, 51, 52, 53, 54, 124, 125, 828, 830, 862, 1122, 1148, 1448],
  },
];

function fail(fileDataId, message) {
  throw new Error(`FileDataID ${fileDataId}: ${message}`);
}

function fourCc(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function walkContainer(bytes, fileDataId) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail(fileDataId, `chunk header is truncated at byte ${offset}.`);
    const tag = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    if (offset + 8 + size > bytes.length) fail(fileDataId, `chunk ${tag || "?"} is truncated.`);
    chunks.push({ tag, size, payloadOffset: offset + 8 });
    offset += 8 + size;
  }
  return chunks;
}

function findChunk(chunks, tag) {
  return chunks.find((chunk) => chunk.tag === tag) ?? null;
}

function readU32List(bytes, chunk) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const values = [];
  for (let offset = 0; offset + 4 <= chunk.size; offset += 4) {
    values.push(view.getUint32(chunk.payloadOffset + offset, true));
  }
  return values;
}

function readAfidEntries(bytes, chunk) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = [];
  for (let offset = 0; offset + 8 <= chunk.size; offset += 8) {
    entries.push({
      animationId: view.getUint16(chunk.payloadOffset + offset, true),
      variationIndex: view.getUint16(chunk.payloadOffset + offset + 2, true),
      fileDataId: view.getUint32(chunk.payloadOffset + offset + 4, true),
    });
  }
  return entries;
}

function readSequenceArray(view, baseOffset, count, fileDataId, what) {
  if (count > MAX_ARRAY_COUNT || baseOffset + count * 0x40 > view.byteLength) {
    fail(fileDataId, `${what} sequence array is outside the file.`);
  }
  const sequences = [];
  for (let index = 0; index < count; index += 1) {
    const at = baseOffset + index * 0x40;
    sequences.push({
      animationId: view.getUint16(at, true),
      variationIndex: view.getUint16(at + 2, true),
      flags: view.getUint32(at + 0xc, true),
    });
  }
  return sequences;
}

/** Reads the model fields the resolver needs from the MD21 payload. */
function readModelHeader(bytes, fileDataId) {
  const chunks = walkContainer(bytes, fileDataId);
  const md21 = findChunk(chunks, "MD21");
  if (!md21 || md21.size < 0x138) fail(fileDataId, "MD21 payload is missing or too short.");
  if (fourCc(bytes, md21.payloadOffset) !== "MD20") fail(fileDataId, "MD21 payload does not begin with MD20.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(md21.payloadOffset + 4, true);
  if (version !== 272 && version !== 274) fail(fileDataId, `M2 version ${version} is not supported.`);
  const base = md21.payloadOffset;
  const sequenceCount = view.getUint32(base + 0x1c, true);
  const sequenceOffset = view.getUint32(base + 0x20, true);
  const sequenceEnd = base + sequenceOffset + sequenceCount * 0x40;
  if (sequenceCount > MAX_ARRAY_COUNT || sequenceEnd > md21.payloadOffset + md21.size) {
    fail(fileDataId, "sequence array is outside the MD21 payload.");
  }
  return {
    viewCount: view.getUint32(base + 0x44, true),
    sequences: readSequenceArray(view, base + sequenceOffset, sequenceCount, fileDataId, "MD21"),
    skinFileDataIds: readU32ListIfPresent(bytes, chunks, "SFID"),
    textureFileDataIds: readU32ListIfPresent(bytes, chunks, "TXID"),
    animationFileReferences: findChunk(chunks, "AFID") ? readAfidEntries(bytes, findChunk(chunks, "AFID")) : [],
    skeletonFileDataId: (() => {
      const skid = findChunk(chunks, "SKID");
      if (!skid || skid.size < 4) return 0;
      return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(skid.payloadOffset, true);
    })(),
  };
}

function readU32ListIfPresent(bytes, chunks, tag) {
  const chunk = findChunk(chunks, tag);
  return chunk ? readU32List(bytes, chunk) : [];
}

/** Reads the SKEL fields the resolver needs (sequences, AFID, SKPD parent). */
function readSkelHeader(bytes, fileDataId) {
  const chunks = walkContainer(bytes, fileDataId);
  const sks1 = findChunk(chunks, "SKS1");
  if (!sks1 || sks1.size < 0x18) fail(fileDataId, "SKS1 chunk is missing or too short.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint32(sks1.payloadOffset + 8, true);
  const dataOffset = view.getUint32(sks1.payloadOffset + 12, true);
  const sequenceEnd = sks1.payloadOffset + dataOffset + count * 0x40;
  if (count > MAX_ARRAY_COUNT || sequenceEnd > sks1.payloadOffset + sks1.size) {
    fail(fileDataId, "SKS1 sequence array is outside the chunk.");
  }
  const afid = findChunk(chunks, "AFID");
  const skpd = findChunk(chunks, "SKPD");
  return {
    sequences: readSequenceArray(view, sks1.payloadOffset + dataOffset, count, fileDataId, "SKS1"),
    animationFileReferences: afid ? readAfidEntries(bytes, afid) : [],
    parentSkeletonFileDataId: skpd && skpd.size >= 4 ? view.getUint32(skpd.payloadOffset, true) : 0,
  };
}

/**
 * Bounded fixed-point resolution of a model's dependency closure. Returns a
 * FileDataID -> kind map ("skin" | "blp" | "skel" | "anim"). Never resolves or
 * requests FileDataID 0.
 */
export async function resolveModelDependencies(modelBytes, animationIds, fetchFileData) {
  const model = readModelHeader(modelBytes, 0);
  const dependencies = new Map();
  for (const skinFileDataId of model.skinFileDataIds.slice(0, model.viewCount)) {
    if (skinFileDataId !== 0) dependencies.set(skinFileDataId, "skin");
  }
  for (const textureFileDataId of model.textureFileDataIds) {
    if (textureFileDataId !== 0) dependencies.set(textureFileDataId, "blp");
  }

  // With a linked skeleton the animation data (sequences + AFID) comes from the
  // skeleton, and the SKPD parent chain contributes additional SKEL files.
  let animationSequences = model.sequences;
  let animationReferences = model.animationFileReferences;
  if (model.skeletonFileDataId !== 0) {
    const visited = new Set();
    let skeletonFileDataId = model.skeletonFileDataId;
    while (skeletonFileDataId !== 0) {
      if (visited.has(skeletonFileDataId)) {
        throw new Error(`SKEL parent chain entered a cycle at FileDataID ${skeletonFileDataId}.`);
      }
      visited.add(skeletonFileDataId);
      const skelBytes = await fetchFileData(skeletonFileDataId);
      dependencies.set(skeletonFileDataId, "skel");
      const skel = readSkelHeader(skelBytes, skeletonFileDataId);
      if (skeletonFileDataId === model.skeletonFileDataId) {
        animationSequences = skel.sequences;
        animationReferences = skel.animationFileReferences;
      }
      skeletonFileDataId = skel.parentSkeletonFileDataId;
    }
  }

  const wanted = new Set(animationIds);
  for (const sequence of animationSequences) {
    if (!wanted.has(sequence.animationId)) continue;
    if (sequence.flags & 0x20) continue; // track data lives in the model/skel file
    const reference = animationReferences.find(
      (entry) => entry.animationId === sequence.animationId && entry.variationIndex === sequence.variationIndex,
    );
    if (reference && reference.fileDataId !== 0) dependencies.set(reference.fileDataId, "anim");
  }
  return dependencies;
}

function validateM2(bytes, fileDataId) {
  const model = readModelHeader(bytes, fileDataId);
  if (model.viewCount < 1) fail(fileDataId, "model declares no views.");
}

function validateSkin(bytes, fileDataId) {
  if (bytes.length < 0x38 || fourCc(bytes, 0) !== "SKIN") fail(fileDataId, "SKIN magic is missing or truncated.");
}

function validateBlp(bytes, fileDataId) {
  if (bytes.length < 148 || fourCc(bytes, 0) !== "BLP2") fail(fileDataId, "BLP2 header is missing or truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  const encoding = view.getUint8(8);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const mipOffset = view.getUint32(20, true);
  const mipSize = view.getUint32(84, true);
  if (version !== 1) fail(fileDataId, `BLP version ${version} is unsupported.`);
  if (encoding !== 1 && encoding !== 2) fail(fileDataId, `unexpected BLP encoding ${encoding}.`);
  if (width === 0 || height === 0) fail(fileDataId, "BLP dimensions are zero.");
  if (mipSize === 0 || mipOffset < 148 || mipOffset + mipSize > bytes.length) {
    fail(fileDataId, "first BLP mip is missing or truncated.");
  }
}

function validateSkel(bytes, fileDataId) {
  const chunks = walkContainer(bytes, fileDataId);
  if (!findChunk(chunks, "SKB1")) fail(fileDataId, "SKEL file is missing the SKB1 bone chunk.");
}

function validateAnim(bytes, fileDataId) {
  if (bytes.length <= 8) fail(fileDataId, "ANIM file is empty.");
}

const KIND_VALIDATORS = { m2: validateM2, skin: validateSkin, blp: validateBlp, skel: validateSkel, anim: validateAnim };

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

async function readBoundedResponse(response, fileDataId) {
  if (!response.body) fail(fileDataId, "response body is missing.");
  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_DOWNLOAD_BYTES) {
      await reader.cancel();
      fail(fileDataId, `response exceeds ${MAX_DOWNLOAD_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (bytes.length === 0) fail(fileDataId, "downloaded file is empty.");
  return bytes;
}

function makeHttpFileDataReader({ baseUrl = DEFAULT_BASE_URL, attempts = 3, timeoutMs = 60_000, fetchImplementation = fetch }) {
  return async (fileDataId) => {
    const url = `${baseUrl}/${fileDataId}?download&version=${BUILD}`;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImplementation(url, { signal: controller.signal, redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return await readBoundedResponse(response, fileDataId);
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
      } finally {
        clearTimeout(timeout);
      }
    }
    const reason = lastError instanceof Error ? lastError.message : String(lastError);
    fail(fileDataId, `download failed after ${attempts} attempts (${reason}).`);
  };
}

async function readManifest(manifestPath) {
  let text;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  let manifest;
  try {
    manifest = JSON.parse(text);
  } catch (error) {
    throw new Error(`failed to parse the manifest at ${manifestPath}: ${error.message}`);
  }
  if (manifest.build !== BUILD) {
    throw new Error(`manifest build ${manifest.build} does not match the pinned build ${BUILD}.`);
  }
  if (!Array.isArray(manifest.assets)) throw new Error("manifest assets must be an array.");
  for (const asset of manifest.assets) {
    if (!asset || typeof asset.fileDataId !== "number" || typeof asset.kind !== "string"
      || typeof asset.byteSize !== "number" || typeof asset.sha256 !== "string") {
      throw new Error("manifest entries must be { fileDataId, kind, byteSize, sha256 }.");
    }
  }
  return manifest;
}

function verifyAgainstPin(fileDataId, bytes, pin) {
  if (bytes.length !== pin.byteSize) {
    fail(fileDataId, `byte size ${bytes.length} does not match the pinned ${pin.byteSize}.`);
  }
  const digest = sha256(bytes);
  if (digest !== pin.sha256) {
    fail(fileDataId, `SHA-256 mismatch (pinned ${pin.sha256}, found ${digest}).`);
  }
}

/**
 * Acquires the full dependency closure for every actor and pins it in the
 * manifest. When the manifest exists and every pinned file is present locally,
 * the run is verify-only: local bytes are checked against the pinned hashes and
 * the network is never touched.
 */
export async function prepareNativeModels({
  actors = MODEL_ACTORS,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  manifestPath = DEFAULT_MANIFEST_PATH,
  baseUrl,
  fetchFileData,
  attempts = 3,
  timeoutMs = 60_000,
} = {}) {
  await mkdir(outputDirectory, { recursive: true });
  const manifest = await readManifest(manifestPath);
  const pinned = manifest ? new Map(manifest.assets.map((asset) => [asset.fileDataId, asset])) : null;

  if (pinned) {
    const localFiles = await Promise.all(manifest.assets.map(async (asset) => {
      try {
        return await readFile(join(outputDirectory, `${asset.fileDataId}.${asset.kind}`));
      } catch (error) {
        if (error?.code === "ENOENT") return null;
        throw error;
      }
    }));
    if (localFiles.every((bytes) => bytes !== null)) {
      manifest.assets.forEach((asset, index) => verifyAgainstPin(asset.fileDataId, localFiles[index], asset));
      console.log(`Verified ${manifest.assets.length} pinned native model files against the manifest.`);
      return;
    }
  }

  const load = fetchFileData ?? makeHttpFileDataReader({ baseUrl, attempts, timeoutMs });
  const ensureBytes = async (fileDataId, kind) => {
    if (fileDataId === 0) throw new Error("FileDataID 0 must never be downloaded.");
    const pin = pinned?.get(fileDataId);
    if (pin) {
      try {
        const local = await readFile(join(outputDirectory, `${fileDataId}.${kind}`));
        verifyAgainstPin(fileDataId, local, pin);
        return local;
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
    const bytes = await load(fileDataId);
    if (pin) verifyAgainstPin(fileDataId, bytes, pin);
    return bytes;
  };

  const closure = new Map();
  for (const actor of actors) {
    const modelBytes = await ensureBytes(actor.modelFileDataId, "m2");
    closure.set(actor.modelFileDataId, { kind: "m2", bytes: modelBytes });
    const dependencies = await resolveModelDependencies(modelBytes, actor.animationIds, (fileDataId) =>
      ensureBytes(fileDataId, "skel"));
    for (const [fileDataId, kind] of dependencies) {
      if (!closure.has(fileDataId)) closure.set(fileDataId, { kind, bytes: null });
    }
  }
  for (const [fileDataId, entry] of closure) {
    if (!entry.bytes) entry.bytes = await ensureBytes(fileDataId, entry.kind);
  }
  for (const [fileDataId, entry] of closure) {
    KIND_VALIDATORS[entry.kind](entry.bytes, fileDataId);
  }
  if (pinned) {
    const unpinned = [...closure.keys()].filter((fileDataId) => !pinned.has(fileDataId));
    if (unpinned.length > 0) {
      throw new Error(`dependency drift: FileDataID ${unpinned.join(", ")} resolved from the models but not pinned in the manifest.`);
    }
  }

  const temporaryDirectory = await mkdtemp(join(outputDirectory, ".prepare-native-models-"));
  try {
    for (const [fileDataId, entry] of closure) {
      const filename = `${fileDataId}.${entry.kind}`;
      const temporary = join(temporaryDirectory, filename);
      await writeFile(temporary, entry.bytes, { flag: "wx" });
      await rename(temporary, join(outputDirectory, filename));
      console.log(`Prepared ${filename} (${entry.bytes.length} bytes, ${sha256(entry.bytes)})`);
    }
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }

  if (!manifest) {
    const assets = [...closure.entries()]
      .map(([fileDataId, entry]) => ({
        fileDataId,
        kind: entry.kind,
        byteSize: entry.bytes.length,
        sha256: sha256(entry.bytes),
      }))
      .sort((a, b) => a.fileDataId - b.fileDataId);
    const contents = `${JSON.stringify({ build: BUILD, actors, assets }, null, 2)}\n`;
    await writeFile(manifestPath, contents, { flag: "wx" });
    console.log(`Pinned ${assets.length} native model assets in ${manifestPath}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareNativeModels().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
