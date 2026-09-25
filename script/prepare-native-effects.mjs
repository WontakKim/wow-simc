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
  {"fileDataId": 4006618, "extension": "m2", "byteSize": 5938, "sha256": "b02fc2e56920aee69a50259b4bf4af663ccab9fb1ff8806282ea383528f35446", "textureFileDataIds": [3982249, 4007016, 4007017, 3722811, 3308414, 4007018], "version": 274, "expectedBoneCount": 5, "expectedEmitterCount": 3},
  {"fileDataId": 3980244, "extension": "m2", "byteSize": 10252, "sha256": "788db595194c59e392da1c4651e9180d534a16f16df2e83d7eb0aa137414e712", "textureFileDataIds": [1560384, 982938, 2114691, 3722816, 3308414, 1983721, 3982251, 1729857, 2395678], "version": 274, "expectedBoneCount": 7, "expectedEmitterCount": 6},
  {"fileDataId": 1598036, "extension": "m2", "byteSize": 6748, "sha256": "46bb520dc3e5c9ee5583e1ee01e379f9311752db5adcbb97c003791e8c618abf", "textureFileDataIds": [1284799, 1284800, 1284801, 1284802], "version": 274, "expectedBoneCount": 4, "expectedEmitterCount": 4},
  {"fileDataId": 1355634, "extension": "m2", "byteSize": 3476, "sha256": "8f11ff91782b6aea867610755e6c75efaaf8dcff63077cdb303b48b6b353ee46", "textureFileDataIds": [1356879, 167007], "version": 274, "expectedBoneCount": 2, "expectedEmitterCount": 2},
  {"fileDataId": 1284864, "extension": "m2", "byteSize": 18556, "sha256": "f1e1234ea9d5febb718d57d0b383217250d0c44c84dc7cc10130f2eb2c38063b", "textureFileDataIds": [1284801, 1284802, 1284799, 1284800], "version": 272, "expectedBoneCount": 11, "expectedEmitterCount": 11},
  {"fileDataId": 1109885, "extension": "m2", "byteSize": 9716, "sha256": "3a0144b50861ef2ac327a5bc1f0c6f9824532eab5481846ad25f7f35f629be7a", "textureFileDataIds": [982941, 982938, 986837, 937025, 241063, 937026, 986838, 930327, 167034, 606564], "version": 272, "expectedBoneCount": 6, "expectedEmitterCount": 6},
  {"fileDataId": 4006621, "extension": "m2", "byteSize": 18682, "sha256": "5778b48a64e1b4f21b1415676ad0e986a9a5fdf98646000012924a9eeee38a52", "textureFileDataIds": [4007019, 4007020, 4007017, 3982249, 4007016, 983668, 1715203, 982938, 4007018, 3722811, 3308414, 3722811, 3389520], "version": 274, "expectedBoneCount": 15, "expectedEmitterCount": 9},
  {"fileDataId": 6211618, "extension": "m2", "byteSize": 7864, "sha256": "cb33c7ca545e968eed9eb4a3bcfd8234f305fa4ca254bf8b5dc094b9c6791a6f", "textureFileDataIds": [1983725, 2924162, 2138647, 2913785, 982938, 2318850, 1718228], "version": 274, "expectedBoneCount": 5, "expectedEmitterCount": 4},
  {"fileDataId": 1571475, "extension": "m2", "byteSize": 3524, "sha256": "726b07fe1e0836af9213de90a44bbc25efdd6461623e8b638d451377273e3a1d", "textureFileDataIds": [1281038, 1571604], "version": 274, "expectedBoneCount": 2, "expectedEmitterCount": 2},
  {"fileDataId": 4392095, "extension": "m2", "byteSize": 6948, "sha256": "33343c30f5d8b42c4bb969c095f45a56136c6c41a8ed566494481d9982856d56", "textureFileDataIds": [3982249, 4007016, 4007017, 3722811, 3308414, 4007018, 4007019, 4007020], "version": 274, "expectedBoneCount": 5, "expectedEmitterCount": 4},
  {"fileDataId": 4050773, "extension": "m2", "byteSize": 12718, "sha256": "bfbf42471672841692b590b995066cf1d4e3d38418a8ce74ad54ea052e8fa724", "textureFileDataIds": [1560384, 982938, 2114691, 3722816, 3308414, 1983721, 3982251, 1729857, 3308408, 1868695, 2395678], "version": 274, "expectedBoneCount": 9, "expectedEmitterCount": 7},
  {"fileDataId": 3982249, "extension": "blp", "byteSize": 88580, "sha256": "bfd1c7d1ae174e7ea68dd92e5abc5e6dbe809a769eaa795b9c6e12931b1b0612"},
  {"fileDataId": 4007016, "extension": "blp", "byteSize": 350724, "sha256": "82efeb05e3af3070fd286d13d9c8f71750001ebf86437b73855e0109bec4107d"},
  {"fileDataId": 4007017, "extension": "blp", "byteSize": 350724, "sha256": "513c21e811382f42d1a94256e9f66c1be4750e3dcc68d3ead4df86e0ec847ea5"},
  {"fileDataId": 3722811, "extension": "blp", "byteSize": 350724, "sha256": "78dbc9cf5a2d45fae08fac4d36761ebe46f2e82ab120eb0bd7c60a6100f350ab"},
  {"fileDataId": 3308414, "extension": "blp", "byteSize": 1228, "sha256": "0dcf13f6ef6db319bcebbea444baf1f7a3a5774f106599477761b197e0585827"},
  {"fileDataId": 4007018, "extension": "blp", "byteSize": 88580, "sha256": "90b032731ca6124b4477710d388ea1b60b629f38b7c582d3e364ff26af9faedb"},
  {"fileDataId": 1560384, "extension": "blp", "byteSize": 350724, "sha256": "3f77edefe85f7eeaed72a8254e50b08ce397fe738c0472fcf4273a3317ae0c2f"},
  {"fileDataId": 982938, "extension": "blp", "byteSize": 1228, "sha256": "67e2ae55d5c797768776b097c986f4122c177db6cb44571fe6c9f1c4dcf44199"},
  {"fileDataId": 2114691, "extension": "blp", "byteSize": 350724, "sha256": "d65d4521de924175fd132b9fc65a1d185cc2bc79c59789a5c5167b8559ff40cb"},
  {"fileDataId": 3722816, "extension": "blp", "byteSize": 88580, "sha256": "8fc637eedb59427afb085eb82172315aaf986e90040e3344b049751455990722"},
  {"fileDataId": 1983721, "extension": "blp", "byteSize": 88580, "sha256": "7505fcbad4349fad0d60cb87f79a8dd332464cfb2aa1aaf70551a7ee07ce4b00"},
  {"fileDataId": 3982251, "extension": "blp", "byteSize": 88580, "sha256": "3eca1afecd5d47b92d2d86688b4d70ea123940b4175c082a8460cfc7b66a03b2"},
  {"fileDataId": 1729857, "extension": "blp", "byteSize": 88580, "sha256": "b7390ffd7ffceabd6cd8cd43577b825e78eedbc03cd67e129df80ceccca99111"},
  {"fileDataId": 2395678, "extension": "blp", "byteSize": 88580, "sha256": "13e0952eaeb5076d6286127b3b4c6a6b30cac1ba872f0107df0701fd6e0bcd3a"},
  {"fileDataId": 1284799, "extension": "blp", "byteSize": 23076, "sha256": "e4d668282090043bb78419c2aa2fa5d1b6d40f6385d77bcb01b7b527d767196d"},
  {"fileDataId": 1284800, "extension": "blp", "byteSize": 23076, "sha256": "b4836bebc9cfc912a003feabd297cd2e78bf6d21c58a2354aa8d2ffe3a0e24d8"},
  {"fileDataId": 1284801, "extension": "blp", "byteSize": 23076, "sha256": "dba298bf290e74cb3030d0f3ee8042b9e593e58e60dc37be54568aae69d07c4f"},
  {"fileDataId": 1284802, "extension": "blp", "byteSize": 3916, "sha256": "d8d371bf14ad03aedaa2b1435e20ecd560eb31e40d5984200aea740918b2eb30"},
  {"fileDataId": 1356879, "extension": "blp", "byteSize": 700260, "sha256": "aae498aa0bb85c6c22b2bbc3f93cadca6ffb8917851999519792bdba6d38964c"},
  {"fileDataId": 167007, "extension": "blp", "byteSize": 12108, "sha256": "65e6d342e45b0a55f0c52cc4731f8ceaf28312c84adc5d5d858c1d7648b1ac8e"},
  {"fileDataId": 982941, "extension": "blp", "byteSize": 3916, "sha256": "495ca1dce4020a6ac1cc5e82af145baa2142fd57f78e4fcff7a0d1302f953a01"},
  {"fileDataId": 986837, "extension": "blp", "byteSize": 23044, "sha256": "6ff75f3725c508f364a8baa75d12dbd224d7b3d410c140608bc096b94abe40e0"},
  {"fileDataId": 937025, "extension": "blp", "byteSize": 23044, "sha256": "45bc37e4df4f017373a96871fc3a1c7606bce9a215c4d3cd7fc3cbbeb1164996"},
  {"fileDataId": 241063, "extension": "blp", "byteSize": 23044, "sha256": "60e4f2e61dcf13df67b3430270841b90a6a0748da30d5239c3f201cc99ef3876"},
  {"fileDataId": 937026, "extension": "blp", "byteSize": 88580, "sha256": "b9f38055a046d985e6c76dbbbbf30befa22d64c1ed995e721895e22e6abdae3a"},
  {"fileDataId": 986838, "extension": "blp", "byteSize": 88580, "sha256": "7dc2d4c852e04968106282e8cc28897fdc2f52d499c77758e57c05aa64e49f81"},
  {"fileDataId": 930327, "extension": "blp", "byteSize": 23044, "sha256": "0900fea7b2f23232644da79709543e127f383653b586af723939e5f19618aad0"},
  {"fileDataId": 167034, "extension": "blp", "byteSize": 3916, "sha256": "ce09ebf4b23d22a7b53db389526e352020820c2da4352a51b79ccee87966e7f8"},
  {"fileDataId": 606564, "extension": "blp", "byteSize": 44964, "sha256": "e76e88214153cc3e8afd069f5b32ccabfd489498505b04c2fb6a8848022451f2"},
  {"fileDataId": 4007019, "extension": "blp", "byteSize": 700260, "sha256": "ce7c826db700fceb0971506837e517bac379a96ba93ed4ea18f074b73c5d22ac"},
  {"fileDataId": 4007020, "extension": "blp", "byteSize": 350724, "sha256": "5fd5009e942acb069693f19fb42c15493cc062de436c3f91a6530e8b87737254"},
  {"fileDataId": 983668, "extension": "blp", "byteSize": 88580, "sha256": "f86ca357e085a8f503b6b713e1c973db9243a00e47502ba9732c7a490e71f6d0"},
  {"fileDataId": 1715203, "extension": "blp", "byteSize": 88580, "sha256": "452fea117135cee43ae174fef19ae07a096ab21a252068d9b0c0b479b3fd8b0f"},
  {"fileDataId": 3389520, "extension": "blp", "byteSize": 350724, "sha256": "7c929ad6021334bf86dae12f7709cbee3e4d6e2a4e744e8fa2f01d30b80464e1"},
  {"fileDataId": 1983725, "extension": "blp", "byteSize": 350724, "sha256": "721a022dc0a467eb34f4973596a71af466a9c1a99e5b5dc2fbc06f082de7a6c2"},
  {"fileDataId": 2924162, "extension": "blp", "byteSize": 88580, "sha256": "7d0563517d354094adec999325675bd08d07546d51f11862adbae0db5c9e5ad8"},
  {"fileDataId": 2138647, "extension": "blp", "byteSize": 88580, "sha256": "04222d4103e9429686a92b91eb16ac104c2162fed7bf65e8e27354d2eaeb1a5c"},
  {"fileDataId": 2913785, "extension": "blp", "byteSize": 88580, "sha256": "d0377396c399b85abf9e19aed7f202d0082ca0f0067d56595b80f9f99b4f19b4"},
  {"fileDataId": 2318850, "extension": "blp", "byteSize": 88580, "sha256": "1c93dd79dd6b9506738df1e2423f405b823802ee6f9f4856c6ac9c310ccb80d7"},
  {"fileDataId": 1718228, "extension": "blp", "byteSize": 23044, "sha256": "3b09c939030a02f92b52510e65ea17102cfb9ed7ad5be2d80b0f9c06cf60dc20"},
  {"fileDataId": 1281038, "extension": "blp", "byteSize": 23044, "sha256": "ec69b794a6071a03ae58fa328351ea19156fb9ea8106f47246e5dd5aa953d756"},
  {"fileDataId": 1571604, "extension": "blp", "byteSize": 88580, "sha256": "8b77b47325a6d54cdb09bebe4ab4fe3fd35a5afa2e48b02055966c91d81c175f"},
  {"fileDataId": 3308408, "extension": "blp", "byteSize": 88580, "sha256": "8192edabbc21df846f2f706735b9a9d8f77a1afb0b9ba48b19259e0043fc187e"},
  {"fileDataId": 1868695, "extension": "blp", "byteSize": 88580, "sha256": "428f023e8bfd1f3346426eaf7bcbfd4c90411d0c43b3bdc4cec504a843bd5613"},
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
  const version = view.getUint32(model.offset + 4, true);
  if (version !== (asset.version ?? 272) || (version !== 272 && version !== 274)) {
    fail(asset, `M2 version ${version} does not match pinned supported version ${asset.version ?? 272}.`);
  }

  const modelLimit = model.offset + model.size;
  const bones = readDescriptor(view, model.offset, 0x2c, 0x58, asset, "bone", modelLimit);
  const vertices = readDescriptor(view, model.offset, 0x3c, 0x30, asset, "vertex", modelLimit);
  const ribbons = readDescriptor(view, model.offset, 0x120, 0xac, asset, "ribbon", modelLimit);
  const emitterStride = 0x1ec;
  const emitters = readDescriptor(view, model.offset, 0x128, emitterStride, asset, "particle emitter", modelLimit);
  const expectedBones = asset.expectedBoneCount ?? 6;
  const expectedEmitters = asset.expectedEmitterCount ?? 6;
  if (bones.count !== expectedBones || emitters.count !== expectedEmitters || vertices.count !== 0 || ribbons.count !== 0) {
    fail(asset, `expected ${expectedBones} bones, ${expectedEmitters} particle emitters, 0 vertices, and 0 ribbons; found ${bones.count}, ${emitters.count}, ${vertices.count}, and ${ribbons.count}.`);
  }
  for (let index = 0; index < emitters.count; index += 1) {
    const emitterOffset = model.offset + emitters.relativeOffset + index * emitterStride;
    if (view.getUint32(emitterOffset, true) !== 0xffffffff) {
      fail(asset, `particle emitter ${index} does not start at the pinned ${emitterStride}-byte record stride.`);
    }
    const boneIndex = view.getUint16(emitterOffset + 0x14, true);
    if (boneIndex >= bones.count) fail(asset, `particle emitter ${index} bone ${boneIndex} is outside the bone array.`);
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
