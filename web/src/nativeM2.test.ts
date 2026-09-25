/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { parseNativeM2 } from "./nativeM2";

const MODEL_BASE = 8;
const PARTICLE_OFFSET = 0x300;
const PARTICLE_STRIDE = 0x1ec;

function buildM2Fixture(options: { emitterCount?: number; includeExp2?: boolean; zSource?: number } = {}) {
  const emitterCount = options.emitterCount ?? 6;
  const payload = new ArrayBuffer(0x3000);
  const view = new DataView(payload);
  const bytes = new Uint8Array(payload);
  let allocationOffset = 0x1200;

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
  writeUint32(4, 272);
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

  writeArray(0x50, 2, 0x240);
  writeArray(0x128, emitterCount, PARTICLE_OFFSET);

  for (let index = 0; index < emitterCount; index += 1) {
    const offset = PARTICLE_OFFSET + index * PARTICLE_STRIDE;
    writeUint32(offset, 0xffffffff);
    writeUint32(offset + 4, index === 0 ? 0x820025 : 0x20021);
    writeFloat32(offset + 8, index + 0.25);
    writeFloat32(offset + 12, -0.5);
    writeFloat32(offset + 16, 0.75);
    writeUint16(offset + 0x14, 0);
    writeUint16(offset + 0x16, index % 2);
    view.setUint8(offset + 0x28, index === 1 ? 2 : 4);
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

  const modelPayload = payload.slice(0, allocationOffset);
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
  const textures = new ArrayBuffer(8);
  new DataView(textures).setUint32(0, 1001, true);
  new DataView(textures).setUint32(4, 1002, true);
  addChunk("TXID", textures);
  if (options.includeExp2) addChunk("EXP2", new ArrayBuffer(4));

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

    expect(() => parseNativeM2(buildM2Fixture({ includeExp2: true }), 704)).toThrow(/FileDataID 704.*EXP2.*unsupported/i);

    const globalSequence = buildM2Fixture();
    new DataView(globalSequence).setInt16(MODEL_BASE + PARTICLE_OFFSET + 0x34 + 2, 0, true);
    expect(() => parseNativeM2(globalSequence, 705)).toThrow(/FileDataID 705.*global sequence.*unsupported/i);

    const parentedBone = buildM2Fixture();
    new DataView(parentedBone).setInt16(MODEL_BASE + 0x1c8, 0, true);
    expect(() => parseNativeM2(parentedBone, 706)).toThrow(/FileDataID 706.*bone 0.*parented.*unsupported/i);

    expect(() => parseNativeM2(buildM2Fixture({ zSource: 0.1 }), 707)).toThrow(
      /FileDataID 707.*emitter 0.*zSource.*unsupported/i,
    );
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
