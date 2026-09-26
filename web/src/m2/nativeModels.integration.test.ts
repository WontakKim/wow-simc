import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseM2File, parseSkinFile } from "./model";
import {
  attachmentMatrix,
  computeSkinnedVertexBounds,
  resolveSequence,
  sampleBoneMatrices,
} from "./sampler";
import { isGeosetVisibleByDefault } from "./geosets";
import {
  UNSUPPORTED_M2_PIXEL_SHADERS,
  UNSUPPORTED_M2_VERTEX_SHADERS,
  selectM2Shaders,
} from "./shaders";

const MODEL_DIRECTORY = resolve(process.cwd(), "public/model/native-models");

interface PreparedActor {
  modelFileDataId: number;
  skinFileDataId: number;
  animationIds: number[];
}

const ACTORS: PreparedActor[] = [
  { modelFileDataId: 125259, skinFileDataId: 478820, animationIds: [0, 9, 10] },
  { modelFileDataId: 1890761, skinFileDataId: 1893903, animationIds: [0, 51, 52, 53, 54, 124, 125, 828, 830, 862, 1122, 1148, 1448] },
];

function readPreparedFile(fileDataId: number, extension: string): ArrayBuffer | null {
  const path = resolve(MODEL_DIRECTORY, `${fileDataId}.${extension}`);
  if (!existsSync(path)) return null;
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

const assetsAvailable = ACTORS.every((actor) => readPreparedFile(actor.modelFileDataId, "m2") !== null
  && readPreparedFile(actor.skinFileDataId, "skin") !== null);

describe.skipIf(!assetsAvailable)("prepared native models", () => {
  if (!assetsAvailable) {
    console.warn("Skipping native model integration tests: run node script/prepare-native-models.mjs to fetch the pinned assets.");
  }

  it("parses the Vulpera male LOD0 model, skin and every replay animation", () => {
    const model = parseM2File(readPreparedFile(1890761, "m2")!, 1890761);
    const skin = parseSkinFile(readPreparedFile(1893903, "skin")!, 1893903);

    expect(model.sequences.length).toBeGreaterThan(0);
    expect(model.bones.length).toBeGreaterThan(0);
    const attachmentIds = model.attachments.map((attachment) => attachment.id);
    for (const id of [21, 22, 34]) expect(attachmentIds).toContain(id);

    for (const animationId of [0, 51, 52, 53, 54, 124, 125, 828, 830, 862, 1122, 1148, 1448]) {
      const resolution = resolveSequence(model, animationId);
      expect(resolution, `animation ${animationId}`).not.toBeNull();
      const matrices = sampleBoneMatrices(model, resolution!, 0);
      expect(matrices, `animation ${animationId}`).toHaveLength(model.bones.length);
      const flat = matrices.flat();
      expect(flat.every((value) => Number.isFinite(value)), `animation ${animationId}`).toBe(true);
    }

    const stand = resolveSequence(model, 0)!;
    const mid = sampleBoneMatrices(model, stand, stand.sequence.durationMs / 2);
    expect(mid.flat().every((value) => Number.isFinite(value))).toBe(true);
    console.log("[native-models] vulpera sequences:", model.sequences.length,
      "bones:", model.bones.length, "attachments:", attachmentIds.join(","));

    const bounds = computeSkinnedVertexBounds(model, skin, null, (section) =>
      isGeosetVisibleByDefault(section.meshPartId));
    expect(bounds).not.toBeNull();
    const height = bounds!.max[2] - bounds!.min[2];
    expect(height).toBeGreaterThan(0);
    console.log("[native-models] vulpera LOD0 visible-geoset bind bounds:",
      JSON.stringify(bounds), "native height:", height.toFixed(3));

    const matrices = sampleBoneMatrices(model, stand, 0);
    const chest = attachmentMatrix(model, matrices, 34);
    expect(chest).not.toBeNull();
    expect(chest!.every((value) => Number.isFinite(value))).toBe(true);
  });

  it("parses the Training Dummy model and its stand/wound sequences", () => {
    const model = parseM2File(readPreparedFile(125259, "m2")!, 125259);
    const skin = parseSkinFile(readPreparedFile(478820, "skin")!, 478820);

    expect(model.sequences.map((sequence) => sequence.animationId).sort((a, b) => a - b)).toEqual([0, 9, 9, 10]);
    expect(model.bones.length).toBeGreaterThan(0);
    const attachmentIds = model.attachments.map((attachment) => attachment.id).sort((a, b) => a - b);
    console.log("[native-models] dummy attachments:", attachmentIds.join(","));

    for (const animationId of [0, 9, 10]) {
      const resolution = resolveSequence(model, animationId);
      expect(resolution, `dummy animation ${animationId}`).not.toBeNull();
      expect(sampleBoneMatrices(model, resolution!, 0).length).toBe(model.bones.length);
    }

    const bounds = computeSkinnedVertexBounds(model, skin, null, () => true);
    expect(bounds).not.toBeNull();
    expect(bounds!.max[2] - bounds!.min[2]).toBeGreaterThan(0);
    console.log("[native-models] dummy bind bounds:", JSON.stringify(bounds));
  });

  it("selects the plain unskinned-no-tex-mod shader pair for every Training Dummy batch", () => {
    const model = parseM2File(readPreparedFile(125259, "m2")!, 125259);
    const skin = parseSkinFile(readPreparedFile(478820, "skin")!, 478820);

    expect(skin.batches.length).toBeGreaterThan(0);
    for (const batch of skin.batches) {
      const selection = selectM2Shaders(batch.shaderId, batch.textureCount);
      expect(selection.vertexShader, `dummy batch ${batch.index} (shaderId 0x${batch.shaderId.toString(16)})`).toBe(0);
      expect(selection.pixelShader, `dummy batch ${batch.index}`).toBe(1);
      expect(selection.unsupportedVertexShader).toBeNull();
      expect(selection.unsupportedPixelShader).toBeNull();
    }
  });

  it("resolves every Vulpera batch to a supported shader pair (no gated shaders)", () => {
    const model = parseM2File(readPreparedFile(1890761, "m2")!, 1890761);
    const skin = parseSkinFile(readPreparedFile(1893903, "skin")!, 1893903);

    expect(skin.batches.length).toBeGreaterThan(0);
    const vertexShaders = new Set<number>();
    const pixelShaders = new Set<number>();
    for (const batch of skin.batches) {
      const selection = selectM2Shaders(batch.shaderId, batch.textureCount);
      expect(selection.unsupportedVertexShader, `vulpera batch ${batch.index} (shaderId 0x${batch.shaderId.toString(16)})`).toBeNull();
      expect(selection.unsupportedPixelShader, `vulpera batch ${batch.index}`).toBeNull();
      vertexShaders.add(selection.vertexShader);
      pixelShaders.add(selection.pixelShader);
    }
    for (const vertexShader of vertexShaders) {
      expect(UNSUPPORTED_M2_VERTEX_SHADERS.has(vertexShader), `VS ${vertexShader}`).toBe(false);
    }
    expect(pixelShaders.has(34)).toBe(false);
    console.log("[native-models] vulpera batch vertex shaders:", [...vertexShaders].sort((a, b) => a - b).join(","),
      "pixel shaders:", [...pixelShaders].sort((a, b) => a - b).join(","));
  });
});
