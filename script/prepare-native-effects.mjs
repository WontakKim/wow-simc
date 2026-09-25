#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUILD = "12.1.0.69933";
const DEFAULT_BASE_URL = "https://wago.tools/api/casc";
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const DEFAULT_OUTPUT_DIRECTORY = join(REPOSITORY_ROOT, "web/public/model/native-effects");

export const NATIVE_EFFECT_DOWNLOADS = [
  { fileDataId: 794788, extension: "m2", byteSize: 9724, sha256: "d74e632a23699e81ca90907baf6f6a74a005e22642567094134bf41ac4393ea4", textureFileDataIds: [397894, 796153, 243229, 669041] },
  { fileDataId: 397894, extension: "blp", byteSize: 88580, sha256: "882871dc36baf215cb4166385e16be327c10f84b0f66f6937d84f7a7ea63c202" },
  { fileDataId: 796153, extension: "blp", byteSize: 44876, sha256: "8d9f1fadfe4422ffd3bb040ec550fdcb81de0f9a003b2c2c71b2d15abf9e56bf" },
  { fileDataId: 243229, extension: "blp", byteSize: 1540, sha256: "f2ecaa3d47fc455148e57154dadd1d6324c5d31136b70172c94a7c1418dde08e" },
  { fileDataId: 669041, extension: "blp", byteSize: 44876, sha256: "ec0af25f0cbfe223e273a7d7cfd8c6d5df1e9e7054eeac23858d8fb463b82a9e" },
  { fileDataId: 613807, extension: "m2", byteSize: 9376, sha256: "0ac91aa529011cd808b5d2880d685f5bf6714813dba898824797c345333376b9", textureFileDataIds: [613804, 613805, 613806, 167020, 167034] },
  { fileDataId: 613804, extension: "blp", byteSize: 6660, sha256: "3890881a5441048e10de3a474a110cb64ed22bcf11e8dd215f60f36de360adce" },
  { fileDataId: 613805, extension: "blp", byteSize: 6660, sha256: "4b5a9d337499d317f5c465d655278be49db9e30f86df4b9b7b80e29c14cffb06" },
  { fileDataId: 613806, extension: "blp", byteSize: 23044, sha256: "68a30b5caa5557f7a9569b4f925eefcdfba05aa2a95899e7f3c0cd8da9224b86" },
  { fileDataId: 167020, extension: "blp", byteSize: 350724, sha256: "d4c485e69747d98297f931cacdb2b7311828a577b975b709e2f8dd6d1daa9c35" },
  { fileDataId: 167034, extension: "blp", byteSize: 3916, sha256: "ce09ebf4b23d22a7b53db389526e352020820c2da4352a51b79ccee87966e7f8" },
];

function fail(asset, message) {
  throw new Error(`FileDataID ${asset.fileDataId}: ${message}`);
}

function fourCc(bytes, offset) {
  if (offset < 0 || offset + 4 > bytes.length) return "";
  return String.fromCharCode(...bytes.subarray(offset, offset + 4));
}

function readDescriptor(view, base, offset, stride, asset, label, limit) {
  if (base + offset + 8 > limit) fail(asset, `${label} descriptor is outside the M2 payload.`);
  const count = view.getUint32(base + offset, true);
  const relativeOffset = view.getUint32(base + offset + 4, true);
  if (count > 1_000_000 || relativeOffset + count * stride > limit - base) {
    fail(asset, `${label} array is outside the M2 payload.`);
  }
  return { count, relativeOffset };
}

function validateM2(bytes, asset) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 0;
  let model = null;
  let textureIds = null;
  let hasSkinIds = false;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) fail(asset, "chunk header is truncated.");
    const tag = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + size > bytes.length) fail(asset, `${tag || "unknown"} chunk is truncated.`);
    if (tag === "MD21") model = { offset: payloadOffset, size };
    if (tag === "SFID") hasSkinIds = size >= 4 && size % 4 === 0;
    if (tag === "TXID") {
      if (size % 4 !== 0) fail(asset, "TXID chunk is not four-byte aligned.");
      textureIds = Array.from({ length: size / 4 }, (_, index) => view.getUint32(payloadOffset + index * 4, true));
    }
    offset = payloadOffset + size;
  }
  if (offset !== bytes.length) fail(asset, "outer chunks do not consume the complete file.");
  if (!model || model.size < 0x130) fail(asset, "MD21 payload is missing or too short.");
  if (!hasSkinIds) fail(asset, "SFID chunk is missing or invalid.");
  if (!textureIds) fail(asset, "TXID chunk is missing.");
  if (fourCc(bytes, model.offset) !== "MD20") fail(asset, "MD21 payload does not begin with MD20.");
  if (view.getUint32(model.offset + 4, true) !== 272) fail(asset, "M2 version is not 272.");

  const modelLimit = model.offset + model.size;
  const bones = readDescriptor(view, model.offset, 0x2c, 0x58, asset, "bone", modelLimit);
  const vertices = readDescriptor(view, model.offset, 0x3c, 0x30, asset, "vertex", modelLimit);
  const ribbons = readDescriptor(view, model.offset, 0x120, 0xac, asset, "ribbon", modelLimit);
  const emitters = readDescriptor(view, model.offset, 0x128, 0x1ec, asset, "particle emitter", modelLimit);
  if (bones.count !== 6 || emitters.count !== 6 || vertices.count !== 0 || ribbons.count !== 0) {
    fail(asset, `expected 6 bones, 6 particle emitters, 0 vertices, and 0 ribbons; found ${bones.count}, ${emitters.count}, ${vertices.count}, and ${ribbons.count}.`);
  }
  if (textureIds.length !== asset.textureFileDataIds.length
    || textureIds.some((fileDataId, index) => fileDataId !== asset.textureFileDataIds[index])) {
    fail(asset, `TXID values ${textureIds.join(", ")} do not match the pinned manifest.`);
  }
}

function validateBlp(bytes, asset) {
  if (bytes.length < 148 || fourCc(bytes, 0) !== "BLP2") fail(asset, "BLP2 header is missing or truncated.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(4, true);
  const encoding = view.getUint8(8);
  const alphaEncoding = view.getUint8(10);
  const width = view.getUint32(12, true);
  const height = view.getUint32(16, true);
  const mipOffset = view.getUint32(20, true);
  const mipSize = view.getUint32(84, true);
  if (version !== 1) fail(asset, `BLP version ${version} is unsupported.`);
  if (encoding !== 2 || (alphaEncoding !== 0 && alphaEncoding !== 7)) {
    fail(asset, `expected BC1/BC3 encoding, found encoding ${encoding} and alpha encoding ${alphaEncoding}.`);
  }
  if (width === 0 || height === 0) fail(asset, "BLP dimensions are zero.");
  if (mipSize === 0 || mipOffset < 148 || mipOffset + mipSize > bytes.length) {
    fail(asset, "first BLP mip is missing or truncated.");
  }
}

export function validateNativeEffectAsset(source, asset) {
  const bytes = source instanceof Uint8Array ? source : new Uint8Array(source);
  if (bytes.length !== asset.byteSize) fail(asset, `expected ${asset.byteSize} bytes, received ${bytes.length}; download is partial or wrong.`);
  const actualSha256 = createHash("sha256").update(bytes).digest("hex");
  if (actualSha256 !== asset.sha256) fail(asset, `SHA-256 mismatch (${actualSha256}); expected ${asset.sha256}.`);
  if (asset.extension === "m2") validateM2(bytes, asset);
  else if (asset.extension === "blp") validateBlp(bytes, asset);
  else fail(asset, `unsupported extension ${asset.extension}.`);
  return bytes;
}

async function readBoundedResponse(response, asset) {
  const contentEncoding = response.headers.get("content-encoding")?.trim().toLowerCase();
  const contentLength = response.headers.get("content-length");
  if ((!contentEncoding || contentEncoding === "identity") && contentLength !== null && /^\d+$/.test(contentLength)) {
    const declaredLength = Number(contentLength);
    if (declaredLength !== asset.byteSize) {
      fail(asset, `declared Content-Length ${declaredLength} does not match the pinned ${asset.byteSize} bytes.`);
    }
  }
  if (!response.body) fail(asset, "response body is missing.");

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > asset.byteSize) {
      await reader.cancel();
      fail(asset, `response exceeds the pinned ${asset.byteSize} bytes.`);
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function fetchWithRetries(url, asset, fetchImplementation, attempts, timeoutMs) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImplementation(url, { signal: controller.signal, redirect: "follow" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await readBoundedResponse(response, asset);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
    } finally {
      clearTimeout(timeout);
    }
  }
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  fail(asset, `download failed after ${attempts} attempts (${reason}).`);
}

export async function prepareNativeEffects({
  assets = NATIVE_EFFECT_DOWNLOADS,
  outputDirectory = DEFAULT_OUTPUT_DIRECTORY,
  baseUrl = DEFAULT_BASE_URL,
  fetchImplementation = fetch,
  attempts = 3,
  timeoutMs = 60_000,
} = {}) {
  await mkdir(outputDirectory, { recursive: true });
  for (const asset of assets) {
    const filename = `${asset.fileDataId}.${asset.extension}`;
    const destination = join(outputDirectory, filename);
    try {
      const existing = await readFile(destination);
      validateNativeEffectAsset(existing, asset);
      console.log(`Verified ${filename}`);
      continue;
    } catch (error) {
      if (error?.code !== "ENOENT") console.warn(`${filename}: replacing invalid local file (${error.message})`);
    }

    const url = `${baseUrl}/${asset.fileDataId}?download&version=${BUILD}`;
    const bytes = await fetchWithRetries(url, asset, fetchImplementation, attempts, timeoutMs);
    validateNativeEffectAsset(bytes, asset);
    const temporaryDirectory = await mkdtemp(join(outputDirectory, ".prepare-native-effects-"));
    try {
      const temporary = join(temporaryDirectory, filename);
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, destination);
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
    console.log(`Prepared ${filename} (${bytes.length} bytes, ${asset.sha256})`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  prepareNativeEffects().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
