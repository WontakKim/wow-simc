/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as nativeM2 from "./nativeM2";
const { parseNativeM2 } = nativeM2;

const MODEL_BASE = 8;
const PARTICLE_OFFSET = 0x300;
const PARTICLE_STRIDE = 0x1ec;

function buildM2Fixture(options: {
  emitterCount?: number;
  includeExp2?: boolean;
  exp2Records?: Array<{ zSource?: number; colorMultiplier?: number; alphaMultiplier?: number }>;
  zSource?: number;
  version?: number;
  extension?: string;
  includeRibbon?: boolean;
  textureCount?: number;
  blends?: number[];
  emitterFlags?: number[];
  textureIds?: number[];
  materialCount?: number;
  txacPairs?: Array<[number, number]>;
} = {}) {
  const emitterCount = options.emitterCount ?? 6;
  const payload = new ArrayBuffer(0x3000);
  const view = new DataView(payload);
  const bytes = new Uint8Array(payload);
  let allocationOffset = Math.max(0x1200, PARTICLE_OFFSET + emitterCount * PARTICLE_STRIDE);

  const writeUint16 = (offset: number, value: number) => view.setUint16(offset, value, true);
  const writeInt16 = (offset: number, value: number) => view.setInt16(offset, value, true);
  const writeUint32 = (offset: number, value: number) => view.setUint32(offset, value, true);
  const writeFloat32 = (offset: number, value: number) => view.setFloat32(offset, value, true);
  const allocate = (size: number) => {
    const offset = allocationOffset;
    allocationOffset = Math.ceil((allocationOffset + size) / 16) * 16;
    return offset;
  };
  const writeArray = (descriptorOffset: number, count: number, offset: number) => {
    writeUint32(descriptorOffset, count);
    writeUint32(descriptorOffset + 4, offset);
  };
  const writeFloatTrack = (offset: number, value: number, compressed?: [number, number, number]) => {
    writeUint16(offset, 0);
    writeInt16(offset + 2, -1);
    const timestampDescriptors = allocate(8);
    const valueDescriptors = allocate(8);
    const timestamps = allocate(4);
    const values = allocate(4);
    writeArray(offset + 4, 1, timestampDescriptors);
    writeArray(offset + 12, 1, valueDescriptors);
    writeArray(timestampDescriptors, 1, timestamps);
    writeArray(valueDescriptors, 1, values);
    writeUint32(timestamps, 0);
    if (compressed) {
      view.setInt8(values, compressed[0]);
      view.setInt8(values + 1, compressed[1]);
      writeInt16(values + 2, compressed[2]);
    } else {
      writeFloat32(values, value);
    }
  };
  const writeParticleTrack = (
    offset: number,
    timestamps: number[],
    values: number[][],
    componentCount: number,
    valueWriter: (offset: number, value: number) => void,
    componentSize: number,
  ) => {
    const timestampOffset = allocate(timestamps.length * 2);
    const valueOffset = allocate(values.length * componentCount * componentSize);
    writeArray(offset, timestamps.length, timestampOffset);
    writeArray(offset + 8, values.length, valueOffset);
    timestamps.forEach((timestamp, index) => writeUint16(timestampOffset + index * 2, timestamp));
    values.forEach((value, valueIndex) => value.forEach((component, componentIndex) => {
      valueWriter(valueOffset + (valueIndex * componentCount + componentIndex) * componentSize, component);
    }));
  };

  bytes.set(new TextEncoder().encode("MD20"), 0);
  writeUint32(4, options.version ?? 272);
  writeUint32(0x10, 0x90);

  writeArray(0x1c, 1, 0x180);
  writeUint16(0x180, 0);
  writeUint16(0x182, 0);
  writeUint32(0x184, 667);

  writeArray(0x2c, 1, 0x1c0);
  writeInt16(0x1c8, -1);
  for (const trackOffset of [0x1d0, 0x1e4, 0x1f8]) writeInt16(trackOffset + 2, -1);
  writeFloat32(0x20c, 0.25);
  writeFloat32(0x210, -0.5);
  writeFloat32(0x214, 0.75);

  const textureCount = options.textureCount ?? 2;
  writeArray(0x50, textureCount, allocate(textureCount * 16));
  const materialCount = options.materialCount ?? 0;
  if (materialCount > 0) {
    const materialOffset = allocate(materialCount * 4);
    writeArray(0x70, materialCount, materialOffset);
    for (let index = 0; index < materialCount; index += 1) {
      writeUint16(materialOffset + index * 4, 0x11);
      writeUint16(materialOffset + index * 4 + 2, 2);
    }
  }
  writeArray(0x128, emitterCount, PARTICLE_OFFSET);

  for (let index = 0; index < emitterCount; index += 1) {
    const offset = PARTICLE_OFFSET + index * PARTICLE_STRIDE;
    writeUint32(offset, 0xffffffff);
    writeUint32(offset + 4, options.emitterFlags?.[index] ?? (index === 0 ? 0x820025 : 0x20021));
    writeFloat32(offset + 8, index + 0.25);
    writeFloat32(offset + 12, -0.5);
    writeFloat32(offset + 16, 0.75);
    writeUint16(offset + 0x14, 0);
    writeUint16(offset + 0x16, options.textureIds?.[index] ?? index % 2);
    view.setUint8(offset + 0x28, options.blends?.[index] ?? (index === 1 ? 2 : 4));
    view.setUint8(offset + 0x29, index % 2 === 0 ? 1 : 2);
    writeInt16(offset + 0x2e, index - 2);
    writeUint16(offset + 0x30, 2);
    writeUint16(offset + 0x32, 2);
    for (const trackOffset of [0x34, 0x48, 0x5c, 0x70, 0x84, 0x98, 0xb0, 0xc8, 0xdc, 0xf0, 0x1c8]) {
      writeInt16(offset + trackOffset + 2, -1);
    }
    writeFloatTrack(offset + 0x34, 2.5);
    writeFloatTrack(offset + 0x48, 0.5);
    writeFloatTrack(offset + 0x5c, 0.25);
    writeFloatTrack(offset + 0x70, Math.PI * 2);
    writeFloatTrack(offset + 0x84, 0, [0, 0, -163]);
    writeFloatTrack(offset + 0x98, 1.5);
    writeFloat32(offset + 0xac, 0.2);
    writeFloatTrack(offset + 0xb0, 12);
    writeFloat32(offset + 0xc4, 1);
    writeFloatTrack(offset + 0xc8, 0.4);
    writeFloatTrack(offset + 0xdc, 0.2);
    writeFloatTrack(offset + 0xf0, options.zSource ?? 0);
    writeParticleTrack(offset + 0x104, [0, 32767], [[255, 128, 0], [0, 64, 255]], 3, writeFloat32, 4);
    writeParticleTrack(offset + 0x114, [0, 32767], [[16384], [0]], 1, writeInt16, 2);
    writeParticleTrack(offset + 0x124, [0, 32767], [[0.5, 0.75], [1, 1.25]], 2, writeFloat32, 4);
    writeFloat32(offset + 0x134, 0.4);
    writeFloat32(offset + 0x138, 0.2);
    writeParticleTrack(offset + 0x13c, [0, 32767], [[1], [3]], 1, writeUint16, 2);
    writeParticleTrack(offset + 0x14c, [], [], 1, writeUint16, 2);
    writeFloat32(offset + 0x15c, 0.1);
    writeFloat32(offset + 0x160, 10);
    writeFloat32(offset + 0x164, 1);
    writeFloat32(offset + 0x168, 2);
    writeFloat32(offset + 0x16c, 4);
    writeFloat32(offset + 0x170, 1);
    writeFloat32(offset + 0x174, 0.15);
    writeFloat32(offset + 0x178, 0.5);
    writeFloat32(offset + 0x17c, 0.25);
    writeFloat32(offset + 0x180, 1.5);
    writeFloat32(offset + 0x184, 0.5);
    writeFloat32(offset + 0x1a0, 0.1);
    writeFloat32(offset + 0x1a4, 0.2);
    writeFloat32(offset + 0x1a8, 0.3);
    writeFloat32(offset + 0x1ac, 0.4);
  }

  const modelPayload = payload.slice(0, options.includeRibbon ? 0x3000 : allocationOffset);
  const chunks: Uint8Array[] = [];
  const addChunk = (tag: string, chunkPayload: ArrayBuffer) => {
    const chunk = new Uint8Array(8 + chunkPayload.byteLength);
    chunk.set(new TextEncoder().encode(tag), 0);
    new DataView(chunk.buffer).setUint32(4, chunkPayload.byteLength, true);
    chunk.set(new Uint8Array(chunkPayload), 8);
    chunks.push(chunk);
  };
  addChunk("MD21", modelPayload);
  const skin = new ArrayBuffer(4);
  new DataView(skin).setUint32(0, 9001, true);
  addChunk("SFID", skin);
  const textures = new ArrayBuffer(textureCount * 4);
  const textureIds = new DataView(textures);
  for (let index = 0; index < textureCount; index += 1) textureIds.setUint32(index * 4, 1001 + index, true);
  addChunk("TXID", textures);
  if (options.txacPairs) {
    const txac = new ArrayBuffer(options.txacPairs.length * 2);
    const txacView = new DataView(txac);
    options.txacPairs.forEach(([first, second], index) => {
      txacView.setUint8(index * 2, first);
      txacView.setUint8(index * 2 + 1, second);
    });
    addChunk("TXAC", txac);
  }
  if (options.includeExp2 || options.exp2Records) {
    const exp2 = new ArrayBuffer(8 + emitterCount * 28);
    const exp2View = new DataView(exp2);
    exp2View.setUint32(0, emitterCount, true);
    exp2View.setUint32(4, 8, true);
    for (let index = 0; index < emitterCount; index += 1) {
      exp2View.setFloat32(8 + index * 28, options.exp2Records?.[index]?.zSource ?? 0, true);
      exp2View.setFloat32(8 + index * 28 + 4, options.exp2Records?.[index]?.colorMultiplier ?? 1, true);
      exp2View.setFloat32(8 + index * 28 + 8, options.exp2Records?.[index]?.alphaMultiplier ?? 1, true);
    }
    addChunk("EXP2", exp2);
  }
  if (options.extension) addChunk(options.extension, new ArrayBuffer(4));

  const result = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
  let resultOffset = 0;
  for (const chunk of chunks) {
    result.set(chunk, resultOffset);
    resultOffset += chunk.length;
  }
  return result.buffer;
}

describe("parseNativeM2", () => {
  it("parses version 272 chunks, all emitter records, tracks, packed gravity, bones, and texture IDs", () => {
    const model = parseNativeM2(buildM2Fixture(), 42);

    expect(model).toMatchObject({
      fileDataId: 42,
      version: 272,
      sequenceDurationMs: 667,
      textureFileDataIds: [1001, 1002],
    });
    expect(model.emitters).toHaveLength(6);
    expect(model.bones).toHaveLength(1);
    expect(model.bones[0].pivot).toEqual([0.25, -0.5, 0.75]);
    expect(model.emitters[0]).toMatchObject({
      index: 0,
      flags: 0x820025,
      position: [0.25, -0.5, 0.75],
      boneIndex: 0,
      textureIndices: [0],
      blendingType: 4,
      emitterType: 1,
      rows: 2,
      columns: 2,
      priorityPlane: -2,
      lifespanVariation: expect.closeTo(0.2),
      emissionRateVariation: 1,
      twinkleSpeed: 10,
      twinklePercent: 1,
      twinkleScale: [2, 4],
      drag: expect.closeTo(0.15),
    });
    expect(model.emitters[1]).toMatchObject({ blendingType: 2, emitterType: 2, textureIndices: [1] });
    expect(model.emitters[0].emissionSpeed.sequences[0]).toEqual({ timestamps: [0], values: [2.5] });
    expect(model.emitters[0].gravity.sequences[0].values[0][2]).toBeCloseTo(-6.909, 3);
    expect(model.emitters[0].color.values[0]).toEqual([1, 128 / 255, 0]);
    expect(model.emitters[0].alpha.values[0]).toBeCloseTo(16384 / 32767);
    expect(model.emitters[0].scale.values[1]).toEqual([1, 1.25]);
    expect(model.emitters[0].headUv).toEqual({ timestamps: [0, 32767], values: [1, 3] });
  });

  it("rejects malformed, missing, and unsupported required source data with FileDataID context", () => {
    const truncated = buildM2Fixture().slice(0, 30);
    expect(() => parseNativeM2(truncated, 700)).toThrow(/FileDataID 700.*chunk.*bounds/i);

    const wrongVersion = buildM2Fixture();
    new DataView(wrongVersion).setUint32(MODEL_BASE + 4, 271, true);
    expect(() => parseNativeM2(wrongVersion, 701)).toThrow(/FileDataID 701.*version 271.*272/i);

    const unsupportedFlags = buildM2Fixture();
    new DataView(unsupportedFlags).setUint32(MODEL_BASE + PARTICLE_OFFSET + 4, 0x420021, true);
    expect(() => parseNativeM2(unsupportedFlags, 702)).toThrow(/FileDataID 702.*emitter 0.*0x400000/i);

    const badTrack = buildM2Fixture();
    new DataView(badTrack).setUint32(MODEL_BASE + PARTICLE_OFFSET + 0x34 + 8, 0xffffff00, true);
    expect(() => parseNativeM2(badTrack, 703)).toThrow(/FileDataID 703.*emitter 0.*emissionSpeed.*bounds/i);

    expect(() => parseNativeM2(buildM2Fixture({ extension: "EXPT" }), 704)).toThrow(/FileDataID 704.*unsupported EXPT/i);

    const globalSequence = buildM2Fixture();
    new DataView(globalSequence).setInt16(MODEL_BASE + PARTICLE_OFFSET + 0x34 + 2, 0, true);
    expect(() => parseNativeM2(globalSequence, 705)).toThrow(/FileDataID 705.*global sequence.*out of bounds/i);

    const parentedBone = buildM2Fixture();
    new DataView(parentedBone).setInt16(MODEL_BASE + 0x1c8, 0, true);
    expect(() => parseNativeM2(parentedBone, 706)).toThrow(/FileDataID 706.*bone 0.*parent 0.*valid bone/i);

    expect(parseNativeM2(buildM2Fixture({ zSource: 0.1 }), 707).emitters[0].zSource.sequences[0].values[0])
      .toBeCloseTo(0.1);
  });
});

describe("authored blend modes and multi-texture fields", () => {
  it("accepts every authored blend mode 0 through 7 and rejects modes beyond 7", () => {
    const model = parseNativeM2(buildM2Fixture({ emitterCount: 8, blends: [0, 1, 2, 3, 4, 5, 6, 7] }), 708);
    expect(model.emitters.map((emitter) => emitter.blendingType)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(() => parseNativeM2(buildM2Fixture({ emitterCount: 1, blends: [8] }), 709)).toThrow(/FileDataID 709.*emitter 0.*blend 8/);
  });

  it("reads the full uint16 texture index without the multi-texture flag and packed indices with it", () => {
    const source = buildM2Fixture({
      emitterCount: 2,
      textureCount: 40,
      emitterFlags: [0x10020021, 0x20021],
      textureIds: [0x881, 35],
    });
    const model = parseNativeM2(source, 710);
    expect(model.emitters[0].textureIndices).toEqual([1, 4, 2]);
    expect(model.emitters[1].textureIndices).toEqual([35]);
  });

  it("decodes the multi-texture scroll parameters and packed scale bytes", () => {
    const source = buildM2Fixture({ emitterCount: 2, emitterFlags: [0x10020021, 0x20021] });
    const view = new DataView(source);
    const offset = PARTICLE_OFFSET;
    view.setUint16(MODEL_BASE + offset + 0x1dc, 0x0200, true);
    view.setUint16(MODEL_BASE + offset + 0x1de, 0x8200, true);
    view.setUint16(MODEL_BASE + offset + 0x1e0, 0x0080, true);
    view.setUint16(MODEL_BASE + offset + 0x1e2, 0x8080, true);
    view.setUint16(MODEL_BASE + offset + 0x1e4, 0x0300, true);
    view.setUint8(MODEL_BASE + offset + 0x2c, 0x21);
    view.setUint8(MODEL_BASE + offset + 0x2d, 0x41);
    const model = parseNativeM2(source, 711);
    expect(model.emitters[0].multiTextureParam0).toEqual([[1, -1], [0.25, -0.25]]);
    expect(model.emitters[0].multiTextureParam1).toEqual([[1.5, 0], [0, 0]]);
    expect(model.emitters[0].multiTextureScale).toEqual([1.03125, 2.03125]);
    expect(model.emitters[1].multiTextureParam0).toEqual([[0, 0], [0, 0]]);
    expect(model.emitters[1].multiTextureScale).toEqual([0, 0]);
  });

  it("splits TXAC pairs into material entries followed by particle entries", () => {
    const pairs: Array<[number, number]> = [[1, 0], [0, 2], [3, 0], [0, 0], [5, 6], [0, 0], [0, 1], [9, 9]];
    const model = parseNativeM2(buildM2Fixture({ materialCount: 2, txacPairs: pairs }), 712);
    expect(model.materialTextureControls).toEqual([[1, 0], [0, 2]]);
    expect(model.particleTextureControls).toEqual([[3, 0], [0, 0], [5, 6], [0, 0], [0, 1], [9, 9]]);
    expect(() => parseNativeM2(buildM2Fixture({ materialCount: 2, txacPairs: pairs.slice(0, 7) }), 713))
      .toThrow(/FileDataID 713.*TXAC.*2 material.*6 particle.*8 pairs.*7/);
  });

  it("names the emission area length/X at 0xc8 and width/Y at 0xdc", () => {
    const model = parseNativeM2(buildM2Fixture(), 714);
    expect(model.emitters[0].emissionAreaLength.sequences[0].values[0]).toBeCloseTo(0.4);
    expect(model.emitters[0].emissionAreaWidth.sequences[0].values[0]).toBeCloseTo(0.2);
  });

  it("exposes the EXP2 static z-source and color/alpha multipliers with the alpha cutoff track", () => {
    const model = parseNativeM2(buildM2Fixture({
      exp2Records: [{ zSource: 2.5, colorMultiplier: 1.5, alphaMultiplier: 0.75 }],
    }), 715);
    expect(model.emitters[0].exp2).toEqual({ zSource: 2.5, colorMultiplier: 1.5, alphaMultiplier: 0.75 });
    expect(model.emitters[1].exp2).toEqual({ zSource: 0, colorMultiplier: 1, alphaMultiplier: 1 });
    expect(model.emitters[0].alphaCutoff).toEqual({ timestamps: [], values: [] });
  });

  it("parses float32 quaternion rotation keys for texture transforms", () => {
    const source = buildM2Fixture({ emitterCount: 1 });
    const view = new DataView(source);
    const writeArray = (offset: number, count: number, dataOffset: number) => {
      view.setUint32(MODEL_BASE + offset, count, true);
      view.setUint32(MODEL_BASE + offset + 4, dataOffset, true);
    };
    const transform = 0xa80;
    writeArray(0x60, 1, transform);
    view.setInt16(MODEL_BASE + transform + 2, -1, true);
    view.setUint16(MODEL_BASE + transform + 20, 0, true);
    view.setInt16(MODEL_BASE + transform + 22, -1, true);
    view.setInt16(MODEL_BASE + transform + 42, -1, true);
    writeArray(transform + 24, 1, 0xb00);
    writeArray(transform + 32, 1, 0xb10);
    writeArray(0xb00, 1, 0xb20);
    writeArray(0xb10, 1, 0xb30);
    view.setUint32(MODEL_BASE + 0xb20, 0, true);
    for (const [index, value] of [0.1, -0.2, 0.3, 0.9].entries()) {
      view.setFloat32(MODEL_BASE + 0xb30 + index * 4, value, true);
    }
    const model = parseNativeM2(source, 716);
    expect(model.textureTransforms[0].rotation.sequences[0].values[0]).toEqual(
      [0.1, -0.2, 0.3, 0.9].map((value) => expect.closeTo(value, 5)),
    );
  });
});

describe("multi-texture fixed-point decoding", () => {
  it("decodes signed sign-magnitude 6.9 values", () => {
    expect(nativeM2.decodeFixed6Point9(0x0200)).toBe(1);
    expect(nativeM2.decodeFixed6Point9(0x0300)).toBe(1.5);
    expect(nativeM2.decodeFixed6Point9(0x0080)).toBe(0.25);
    expect(nativeM2.decodeFixed6Point9(0x8200)).toBe(-1);
    expect(nativeM2.decodeFixed6Point9(0x8080)).toBe(-0.25);
    expect(nativeM2.decodeFixed6Point9(0)).toBe(0);
  });

  it("decodes packed multi-texture scale bytes", () => {
    expect(nativeM2.decodeMultiTextureScale(0)).toBe(0);
    expect(nativeM2.decodeMultiTextureScale(0x20)).toBe(1);
    expect(nativeM2.decodeMultiTextureScale(0x21)).toBe(1.03125);
    expect(nativeM2.decodeMultiTextureScale(0x41)).toBe(2.03125);
  });
});

describe("prepared original M2 assets", () => {
  it.each([
    {
      fileDataId: 794788,
      textures: [397894, 796153, 243229, 669041],
      firstRate: 5,
      flags: [0x820031, 0x830031, 0x820025, 0x830031, 0x830021, 0x830021],
    },
    {
      fileDataId: 613807,
      textures: [613804, 613805, 613806, 167020, 167034],
      firstRate: 100,
      flags: [0x30121, 0x30123, 0x30021, 0x30021, 0x20021, 0x20229],
    },
  ])("parses all six authored emitters from FileDataID $fileDataId", async ({ fileDataId, textures, firstRate, flags }) => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const url = resolve(process.cwd(), `public/model/native-effects/${fileDataId}.m2`);
    if (!existsSync(url)) throw new Error("Native assets are missing. Run node script/prepare-native-effects.mjs.");
    const bytes = readFileSync(url);
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const model = parseNativeM2(source, fileDataId);

    expect(model.version).toBe(272);
    expect(model.sequenceDurationMs).toBe(667);
    expect(model.emitters).toHaveLength(6);
    expect(model.bones).toHaveLength(6);
    expect(model.textureFileDataIds).toEqual(textures);
    expect(model.emitters.map((emitter) => emitter.flags)).toEqual(flags);
    expect(model.emitters[0].emissionRate.sequences[0].values[0]).toBe(firstRate);
    expect(model.emitters.every((emitter) => emitter.textureIndices.length === 1)).toBe(true);
  });
});


describe("additional original particle structures", () => {
  it("accepts version 274 with all 492 bytes per emitter", () => {
    const model = parseNativeM2(buildM2Fixture({ version: 274 }), 4006618);
    expect(model.version).toBe(274);
    expect(model.emitters).toHaveLength(6);
    expect(model.emitters[5].position[0]).toBeCloseTo(5.25);
  });

  it.each(["TXAC", "EXP2", "PGD1", "LDV1", "DETL"])("recognizes the %s extension chunk in real M2 data", async (extension) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const bytes = readFileSync(resolve(process.cwd(), "public/model/native-effects/4006618.m2"));
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const model = parseNativeM2(source, 4006618);
    expect(model.emitters).toHaveLength(3);
    expect(model.extensionChunks).toContain(extension);
  });

  it("reads bounded global sequence durations and preserves referenced tracks", () => {
    const source = buildM2Fixture();
    const view = new DataView(source);
    view.setUint32(MODEL_BASE + 0x14, 1, true);
    view.setUint32(MODEL_BASE + 0x18, 0x2f0, true);
    view.setUint32(MODEL_BASE + 0x2f0, 2767, true);
    view.setInt16(MODEL_BASE + PARTICLE_OFFSET + 0x34 + 2, 0, true);
    const model = parseNativeM2(source, 4392095);
    expect(model.globalSequenceDurationsMs).toEqual([2767]);
    expect(model.emitters[0].emissionSpeed.globalSequence).toBe(0);
  });

  it("selects sequence zero duration for a stationary preview with multiple sequences", () => {
    const source = buildM2Fixture();
    const view = new DataView(source);
    view.setUint32(MODEL_BASE + 0x1c, 2, true);
    view.setUint32(MODEL_BASE + 0x180 + 0x40 + 4, 1400, true);
    const model = parseNativeM2(source, 3980244);
    expect(model.sequenceDurationMs).toBe(667);
    expect(model.sequenceDurationsMs).toEqual([667, 1400]);
  });

  it("parses authored mesh vertex weights, normals, UV sets and texture-unit lookups", () => {
    const source = buildM2Fixture();
    const view = new DataView(source);
    view.setUint32(MODEL_BASE + 0x3c, 1, true);
    view.setUint32(MODEL_BASE + 0x40, 0x280, true);
    view.setFloat32(MODEL_BASE + 0x280, 2, true);
    view.setFloat32(MODEL_BASE + 0x284, 3, true);
    view.setFloat32(MODEL_BASE + 0x288, 4, true);
    view.setUint8(MODEL_BASE + 0x28c, 255);
    view.setFloat32(MODEL_BASE + 0x294, 1, true);
    view.setFloat32(MODEL_BASE + 0x2a0, 0.25, true);
    view.setFloat32(MODEL_BASE + 0x2a4, 0.75, true);
    view.setFloat32(MODEL_BASE + 0x2a8, 0.5, true);
    view.setFloat32(MODEL_BASE + 0x2ac, 0.125, true);
    view.setUint32(MODEL_BASE + 0x70, 1, true);
    view.setUint32(MODEL_BASE + 0x74, 0x2b0, true);
    view.setUint16(MODEL_BASE + 0x2b0, 0x15, true);
    view.setUint16(MODEL_BASE + 0x2b2, 2, true);
    view.setUint32(MODEL_BASE + 0x80, 1, true);
    view.setUint32(MODEL_BASE + 0x84, 0x2b4, true);
    view.setUint16(MODEL_BASE + 0x2b4, 1, true);
    const model = parseNativeM2(source, 4006618);
    expect(model.vertices[0]).toEqual({ position: [2, 3, 4], boneWeights: [255, 0, 0, 0], boneIndices: [0, 0, 0, 0], normal: [1, 0, 0], uv: [[0.25, 0.75], [0.5, 0.125]] });
    expect(model.materials).toEqual([{ flags: 0x15, blendMode: 2 }]);
    expect(model.textureLookup).toEqual([1]);
    expect(model.skinFileDataIds).toEqual([9001]);
  });

  it("parses authored 0xb0-byte ribbon records and validates their material/texture references", () => {
    const source = buildM2Fixture({ emitterCount: 0, version: 274, includeRibbon: true });
    const view = new DataView(source);
    const writeArray = (offset: number, count: number, dataOffset: number) => {
      view.setUint32(MODEL_BASE + offset, count, true);
      view.setUint32(MODEL_BASE + offset + 4, dataOffset, true);
    };
    writeArray(0x120, 1, 0x2e00);
    writeArray(0x70, 1, 0x2de0);
    view.setUint16(MODEL_BASE + 0x2de0, 0x155, true);
    view.setUint16(MODEL_BASE + 0x2de2, 2, true);
    const ribbon = 0x2e00;
    view.setUint32(MODEL_BASE + ribbon, 0xffffffff, true);
    view.setUint32(MODEL_BASE + ribbon + 4, 0, true);
    view.setFloat32(MODEL_BASE + ribbon + 8, 0.25, true);
    writeArray(ribbon + 0x14, 1, 0x2ec0);
    writeArray(ribbon + 0x1c, 1, 0x2ed0);
    view.setUint16(MODEL_BASE + 0x2ec0, 1, true);
    view.setUint16(MODEL_BASE + 0x2ed0, 0, true);
    for (const offset of [0x24, 0x38, 0x4c, 0x60, 0x84, 0x98]) {
      view.setInt16(MODEL_BASE + ribbon + offset + 2, -1, true);
    }
    view.setFloat32(MODEL_BASE + ribbon + 0x74, 32, true);
    view.setFloat32(MODEL_BASE + ribbon + 0x78, 0.4, true);
    view.setFloat32(MODEL_BASE + ribbon + 0x7c, -2.5, true);
    view.setUint16(MODEL_BASE + ribbon + 0x80, 1, true);
    view.setUint16(MODEL_BASE + ribbon + 0x82, 1, true);
    view.setInt16(MODEL_BASE + ribbon + 0xac, 3, true);
    expect(parseNativeM2(source, 4329984).ribbons).toMatchObject([{
      boneIndex: 0, position: [0.25, 0, 0], textureIndices: [1], materialIndices: [0],
      edgesPerSecond: 32, gravity: -2.5, rows: 1, columns: 1,
      priorityPlane: 3, color: { globalSequence: -1 }, alpha: { globalSequence: -1 },
    }]);
    expect(parseNativeM2(source, 4329984).ribbons[0].edgeLifetime).toBeCloseTo(0.4);
    view.setUint16(MODEL_BASE + 0x2ec0, 99, true);
    expect(() => parseNativeM2(source, 4329984)).toThrow(/FileDataID 4329984.*ribbon 0.*texture.*bounds/i);
  });
});


describe("eleven pinned particle-only sources", () => {
  it.each([
    [4006618, 274, 3], [3980244, 274, 6], [1598036, 274, 4],
    [1355634, 274, 2], [1284864, 272, 11], [1109885, 272, 6],
    [4006621, 274, 9], [6211618, 274, 4], [1571475, 274, 2],
    [4392095, 274, 4], [4050773, 274, 7],
  ])("parses every emitter of FileDataID %i", async (fileDataId, version, count) => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const bytes = readFileSync(resolve(process.cwd(), `public/model/native-effects/${fileDataId}.m2`));
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const model = parseNativeM2(source, fileDataId);
    expect(model.version).toBe(version);
    expect(model.emitters).toHaveLength(count);

    const view = new DataView(source);
    expect(String.fromCharCode(...new Uint8Array(source, 0, 4))).toBe("MD21");
    const modelBase = 8;
    const emitterCount = view.getUint32(modelBase + 0x128, true);
    const emitterOffset = view.getUint32(modelBase + 0x12c, true);
    expect(emitterCount).toBe(count);
    for (let index = 0; index < emitterCount; index += 1) {
      const record = modelBase + emitterOffset + index * 0x1ec;
      expect(view.getUint32(record, true)).toBe(0xffffffff);
      expect(view.getUint16(record + 0x14, true)).toBe(model.emitters[index].boneIndex);
      expect(view.getUint32(record + 4, true)).toBe(model.emitters[index].flags);
      expect(view.getUint16(record + 0x30, true)).toBe(model.emitters[index].rows);
      expect(view.getUint16(record + 0x32, true)).toBe(model.emitters[index].columns);
    }
  });
});


describe("Lightning Bolt DBOC extension", () => {
  it("accepts the bounded four-field chunk without assigning undocumented semantics", () => {
    const original = readFileSync(resolve(process.cwd(), "public/model/native-effects/6211618.m2"));
    const chunk = new Uint8Array(24);
    const view = new DataView(chunk.buffer);
    chunk.set(new TextEncoder().encode("DBOC"));
    view.setUint32(4, 16, true);
    view.setFloat32(8, 0.6667, true);
    view.setFloat32(12, 1.5, true);
    const source = new Uint8Array(original.length + chunk.length);
    source.set(original);
    source.set(chunk, original.length);
    expect(parseNativeM2(source.buffer, 6211618).dboc).toEqual({ floats: [expect.closeTo(0.6667), 1.5], integers: [0, 0] });
    const shortSource = source.slice(0, -4);
    new DataView(shortSource.buffer).setUint32(original.length + 4, 12, true);
    expect(() => parseNativeM2(shortSource.buffer, 6211618)).toThrow(/FileDataID 6211618.*DBOC.*size/i);
  });
});

describe("original skin profile", () => {
  it("resolves triangle indices through the skin vertex lookup and assigns the authored batch", () => {
    const source = new ArrayBuffer(0xb0);
    const view = new DataView(source);
    new Uint8Array(source).set(new TextEncoder().encode("SKIN"));
    const array = (offset: number, count: number, start: number) => {
      view.setUint32(offset, count, true);
      view.setUint32(offset + 4, start, true);
    };
    array(4, 3, 0x40);
    array(12, 3, 0x48);
    array(20, 3, 0x50);
    array(28, 1, 0x60);
    array(36, 1, 0x90);
    for (const [index, vertex] of [2, 1, 0].entries()) view.setUint16(0x40 + index * 2, vertex, true);
    for (const index of [0, 1, 2]) view.setUint16(0x48 + index * 2, index, true);
    view.setUint16(0x60 + 6, 3, true);
    view.setUint16(0x60 + 10, 3, true);
    view.setUint16(0x60 + 12, 1, true);
    view.setUint16(0x90 + 2, 0x4014, true);
    view.setUint16(0x90 + 14, 2, true);
    const parser = (nativeM2 as Record<string, unknown>).parseNativeSkin as ((bytes: ArrayBuffer, fileId: number, count: number) => unknown) | undefined;
    expect(parser?.(source, 9001, 3)).toMatchObject({
      vertexLookup: [2, 1, 0], indices: [0, 1, 2],
      sections: [expect.objectContaining({ vertexCount: 3, indexCount: 3 })],
      batches: [expect.objectContaining({ shaderId: 0x4014, textureCount: 2 })],
    });
  });

  it("extends only the triangle index start by the SKIN section level", () => {
    const indexStart = 64 + 65536;
    const source = new ArrayBuffer(0x20200);
    const view = new DataView(source);
    new Uint8Array(source).set(new TextEncoder().encode("SKIN"));
    const array = (offset: number, count: number, start: number) => {
      view.setUint32(offset, count, true);
      view.setUint32(offset + 4, start, true);
    };
    array(4, 6, 0x40);
    array(12, indexStart + 3 + 7, 0x50);
    array(20, 6, 0x200f0);
    array(28, 1, 0x20120);
    array(36, 1, 0x20150);
    for (let index = 0; index < 6; index += 1) view.setUint16(0x40 + index * 2, index, true);
    for (let offset = 0; offset < 3; offset += 1) view.setUint16(0x50 + (indexStart + offset) * 2, 3 + offset, true);
    view.setUint16(0x20120 + 2, 1, true);
    view.setUint16(0x20120 + 4, 3, true);
    view.setUint16(0x20120 + 6, 3, true);
    view.setUint16(0x20120 + 8, 64, true);
    view.setUint16(0x20120 + 10, 3, true);
    view.setUint16(0x20120 + 12, 1, true);
    view.setUint16(0x20150 + 4, 0, true);
    view.setUint16(0x20150 + 14, 1, true);
    const skin = (nativeM2 as Record<string, unknown>).parseNativeSkin as ((bytes: ArrayBuffer, fileId: number, count: number) => unknown) | undefined;
    expect(skin?.(source, 9002, 6)).toMatchObject({
      sections: [{ vertexStart: 3, vertexCount: 3, indexStart, indexCount: 3, boneCount: 1 }],
    });
  });
});


describe("pinned Ancestral Swiftness mesh", () => {
  it("parses the original geometry, SKIN batch, material, animated texture transform and particle emitters", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const read = (name: string) => {
      const bytes = readFileSync(resolve(process.cwd(), `public/model/native-effects/${name}`));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
    const model = parseNativeM2(read("4290517.m2"), 4290517);
    const skin = nativeM2.parseNativeSkin(read("4291424.skin"), 4291424, model.vertices.length);
    expect(model).toMatchObject({ version: 274, skinFileDataIds: [4291424, 4291426, 4291428, 4291430], materials: [{ flags: 0x1095, blendMode: 2 }] });
    expect(model.sequenceIds).toEqual([0, 158, 213]);
    expect(model.vertices).toHaveLength(1533);
    expect(model.emitters).toHaveLength(4);
    expect(model.textureTransforms[0].translation.sequences[0].values.length).toBeGreaterThan(0);
    expect(skin.vertexLookup).toHaveLength(612);
    expect(skin.indices).toHaveLength(2700);
    expect(skin.batches).toEqual([expect.objectContaining({ shaderId: 0x4014, textureCount: 2, materialIndex: 0 })]);
  });
});

describe("original Lightning Bolt missile source", () => {
  it("parses the five emitters, DBOC fields, LOD0 triangles and additive material from pinned bytes", () => {
    const read = (id: number, extension: string) => {
      const bytes = readFileSync(resolve(process.cwd(), `public/model/native-effects/${id}.${extension}`));
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    };
    const model = parseNativeM2(read(6211617, "m2"), 6211617);
    const skin = nativeM2.parseNativeSkin(read(6212146, "skin"), 6212146, model.vertices.length);
    expect(model).toMatchObject({ version: 274, skinFileDataIds: [6212146],
      materials: [{ flags: 0x1155, blendMode: 4 }], dboc: { floats: [expect.closeTo(2 / 3), 1.5], integers: [0, 0] } });
    expect(model.emitters).toHaveLength(5);
    expect(model.vertices).toHaveLength(50);
    expect(skin.batches).toEqual([expect.objectContaining({ shaderId: 0x14, textureCount: 2, materialIndex: 0 })]);
    expect(skin.indices).toHaveLength(192);
  });
});

describe("original Lava Burst ribbon source", () => {
  it("measures three 0xb0-byte records and resolves authored materials and tracks", () => {
    const bytes = readFileSync(resolve(process.cwd(), "public/model/native-effects/4329984.m2"));
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const model = parseNativeM2(source, 4329984);
    expect(model.ribbons).toHaveLength(3);
    expect(model.ribbons.map((ribbon) => ribbon.boneIndex)).toEqual([14, 15, 16]);
    expect(model.ribbons.map((ribbon) => ribbon.textureIndices)).toEqual([[12, 13, 4], [12, 1, 14], [12, 1, 14]]);
    expect(model.ribbons.map((ribbon) => model.materials[ribbon.materialIndices[0]].blendMode)).toEqual([4, 2, 2]);
    expect(model.ribbons.map((ribbon) => ribbon.edgesPerSecond)).toEqual([1, 32, 32]);
    expect(model.vertices).toHaveLength(0);
  });
});
