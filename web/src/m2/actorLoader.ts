// Fetches and verifies the pinned native actor assets (M2, LOD0 SKIN, BLP
// body textures) from web/public/model/native-models against
// web/src/nativeModelManifest.json, and decodes them into renderer inputs.
//
// Color-domain policy: BLP bytes are display-domain. The decoded textures are
// bound without an sRGB internal format (NoColorSpace) so the M2 combiners
// sample the authored bytes directly and write them to the canvas without a
// second encode; do not set SRGBColorSpace here.

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from "three";
import { NoColorSpace } from "three";
import { decodeNativeBlp } from "../nativeBlp";
import { parseM2File, parseSkinFile, type M2Model, type M2Skin } from "./model";

const ASSET_ROOT = "/model/native-models";
const SETUP_COMMAND = "node script/prepare-native-models.mjs";

interface ManifestActor {
  name: string;
  modelFileDataId: number;
  animationIds: number[];
}

interface ManifestAsset {
  fileDataId: number;
  kind: "m2" | "skin" | "blp";
  byteSize: number;
  sha256: string;
}

interface NativeModelManifest {
  build: string;
  actors: ManifestActor[];
  assets: ManifestAsset[];
}
export type { NativeModelManifest };

export interface NativeActorBundle {
  model: M2Model;
  skin: M2Skin;
  /** Decoded body BLPs keyed by model texture slot index (replaceable slots stay absent). */
  textures: Map<number, Texture>;
  animationIds: number[];
}

async function sha256(source: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function fetchPinnedAsset(asset: ManifestAsset) {
  const extension = asset.kind === "m2" ? "m2" : asset.kind === "skin" ? "skin" : "blp";
  const response = await fetch(`${ASSET_ROOT}/${asset.fileDataId}.${extension}`);
  if (!response.ok) {
    throw new Error(`FileDataID ${asset.fileDataId} (${extension}): request failed with status ${response.status}. Run ${SETUP_COMMAND}. No placeholder model was substituted.`);
  }
  const source = await response.arrayBuffer();
  const actualSha256 = await sha256(source);
  if (actualSha256 !== asset.sha256) {
    throw new Error(`FileDataID ${asset.fileDataId} (${extension}): SHA-256 mismatch (${actualSha256}); expected ${asset.sha256}. Run ${SETUP_COMMAND}. No placeholder model was substituted.`);
  }
  return source;
}

function createDisplayDomainTexture(decoded: ReturnType<typeof decodeNativeBlp>) {
  const texture = new DataTexture(decoded.pixels, decoded.width, decoded.height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = NoColorSpace;
  texture.flipY = true;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Loads one pinned actor by manifest name. Only textures with a TXID entry in
 * the manifest are fetched; customization (replaceable) slots have no file and
 * surface as pending through the renderer.
 */
export async function loadNativeActorBundle(manifest: NativeModelManifest, name: string): Promise<NativeActorBundle> {
  const actor = manifest.actors.find((entry) => entry.name === name);
  if (!actor) throw new Error(`Actor ${name} is not listed in nativeModelManifest.json.`);
  const modelAsset = manifest.assets.find((asset) => asset.kind === "m2" && asset.fileDataId === actor.modelFileDataId);
  if (!modelAsset) throw new Error(`Actor ${name}: M2 FileDataID ${actor.modelFileDataId} is not pinned in nativeModelManifest.json.`);

  const modelSource = await fetchPinnedAsset(modelAsset);
  const model = parseM2File(modelSource, actor.modelFileDataId);
  const skinFileDataId = model.skinFileDataIds[0];
  const skinAsset = manifest.assets.find((asset) => asset.kind === "skin" && asset.fileDataId === skinFileDataId);
  if (!skinAsset) throw new Error(`Actor ${name}: LOD0 SKIN FileDataID ${skinFileDataId} is not pinned in nativeModelManifest.json.`);
  const skin = parseSkinFile(await fetchPinnedAsset(skinAsset), skinFileDataId);

  const textures = new Map<number, Texture>();
  await Promise.all(model.textureFileDataIds.map(async (fileDataId, slotIndex) => {
    if (fileDataId === 0) return;
    const asset = manifest.assets.find((entry) => entry.kind === "blp" && entry.fileDataId === fileDataId);
    if (!asset) return; // customization slots arrive with N3; renderer surfaces them as pending
    const decoded = decodeNativeBlp(await fetchPinnedAsset(asset), fileDataId);
    textures.set(slotIndex, createDisplayDomainTexture(decoded));
  }));

  return { model, skin, textures, animationIds: actor.animationIds };
}
