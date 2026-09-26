import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { Box3, Matrix4, Vector3 } from "three";
import { ACTOR_BASE_YAW, NATIVE_BASIS } from "../GenuineModelScene";
import { parseM2File, parseSkinFile } from "./model";
import type { Vec3 } from "./model";
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

  it("orients the native actors upright and facing each other (N2-FIX)", () => {
    const vulpera = parseM2File(readPreparedFile(1890761, "m2")!, 1890761);
    const vulperaSkin = parseSkinFile(readPreparedFile(1893903, "skin")!, 1893903);
    const dummy = parseM2File(readPreparedFile(125259, "m2")!, 125259);
    const dummySkin = parseSkinFile(readPreparedFile(478820, "skin")!, 478820);

    // The same orientation mountNativeActor puts on the actor root:
    // yaw(ACTOR_BASE_YAW) · NATIVE_BASIS.
    const orientation = new Matrix4()
      .makeRotationY(ACTOR_BASE_YAW)
      .multiply(NATIVE_BASIS);

    // Native M2 is Z-up, so native +Z must become three +Y or the actors lie
    // on their backs with height rendered as depth.
    const up = new Vector3(0, 0, 1).applyMatrix4(orientation);
    expect(up.x).toBeCloseTo(0, 3);
    expect(up.y).toBeCloseTo(1, 3);
    expect(up.z).toBeCloseTo(0, 3);

    // Real data: the Vulpera's Head attachment (11) sits about 1 unit above
    // the ground in native space, so after conversion its height must read on
    // three Y, not three Z.
    const stand = resolveSequence(vulpera, 0)!;
    const pose = sampleBoneMatrices(vulpera, stand, 0);
    const head = attachmentMatrix(vulpera, pose, 11)!;
    const headNativeZ = head[14];
    const headConverted = new Vector3(head[12], head[13], head[14]).applyMatrix4(orientation);
    expect(headNativeZ).toBeGreaterThan(0.9);
    expect(headConverted.y).toBeGreaterThan(0.9);
    expect(Math.abs(headConverted.y - headNativeZ)).toBeLessThan(0.1);

    // Bind-pose bounds: the largest extent must be height (three Y), and the
    // lowest point must sit at the native minimum height (feet on the ground
    // once placeModel drops bounds.min.y to 0).
    const convertBounds = (bounds: { min: Vec3; max: Vec3 }) => {
      const converted = new Box3();
      for (const x of [bounds.min[0], bounds.max[0]]) {
        for (const y of [bounds.min[1], bounds.max[1]]) {
          for (const z of [bounds.min[2], bounds.max[2]]) {
            converted.expandByPoint(new Vector3(x, y, z).applyMatrix4(orientation));
          }
        }
      }
      return converted;
    };

    const vulperaBounds = convertBounds(computeSkinnedVertexBounds(vulpera, vulperaSkin, null, () => true)!);
    const vulperaSize = vulperaBounds.getSize(new Vector3());
    // Native extents: height (Z) 1.65 > depth (X) 1.14 > width (Y) 0.99.
    expect(vulperaSize.y).toBeGreaterThan(1.5);
    expect(vulperaSize.y).toBeGreaterThan(vulperaSize.x);
    expect(vulperaSize.y).toBeGreaterThan(vulperaSize.z);
    expect(vulperaBounds.min.y).toBeGreaterThan(-0.1);
    expect(vulperaBounds.min.y).toBeLessThan(0.1);

    const dummyBounds = convertBounds(computeSkinnedVertexBounds(dummy, dummySkin, null, () => true)!);
    const dummySize = dummyBounds.getSize(new Vector3());
    // Native extents: post height (Z) 2.91 > crossbar (Y) 1.93 > thickness (X)
    // 0.55; the post top reads at native Z 2.75.
    expect(dummySize.y).toBeGreaterThan(2.5);
    expect(dummySize.y).toBeGreaterThan(dummySize.x);
    expect(dummySize.y).toBeGreaterThan(dummySize.z);
    expect(dummyBounds.max.y).toBeGreaterThan(2.5);

    // Real data: the Vulpera is authored facing native +X — the muzzle/face
    // attachments (10, 17, 29) sit at max X (+0.15) while the tail sweeps to
    // min X (-0.99). arrangeCombatants stands the caster at x=-4 facing the
    // dummy at x=+4, so the orientation must keep native forward on three +X.
    const forward = new Vector3(1, 0, 0).applyMatrix4(orientation);
    expect(forward.x).toBeGreaterThan(0.7);
    expect(Math.abs(forward.y)).toBeLessThan(0.1);
    expect(Math.abs(forward.z)).toBeLessThan(0.1);
  });
});
