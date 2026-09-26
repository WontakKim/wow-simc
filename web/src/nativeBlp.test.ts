/// <reference types="node" />
import { describe, expect, it } from "vitest";
import { decodeNativeBlp } from "./nativeBlp";
import { NATIVE_EFFECT_ASSETS } from "./nativeEffectAssets";

function makeBlp(alphaDepth: number, alphaEncoding: number, block: Uint8Array) {
  const source = new Uint8Array(1172 + block.length);
  source.set(new TextEncoder().encode("BLP2"), 0);
  const view = new DataView(source.buffer);
  view.setUint32(4, 1, true);
  source[8] = 2;
  source[9] = alphaDepth;
  source[10] = alphaEncoding;
  source[11] = 1;
  view.setUint32(12, 4, true);
  view.setUint32(16, 4, true);
  view.setUint32(20, 1172, true);
  view.setUint32(84, block.length, true);
  source.set(block, 1172);
  return source.buffer;
}

function selectors(...values: number[]) {
  return values.reduce((packed, value, index) => packed | (value << (index * 2)), 0) >>> 0;
}

describe("decodeNativeBlp", () => {
  it("decodes exact BC1 endpoint and selector pixels", () => {
    const block = new Uint8Array(8);
    const view = new DataView(block.buffer);
    view.setUint16(0, 0xf800, true);
    view.setUint16(2, 0x07e0, true);
    view.setUint32(4, selectors(0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3, 0, 1, 2, 3), true);

    const image = decodeNativeBlp(makeBlp(0, 0, block), 1001);

    expect(image).toMatchObject({ width: 4, height: 4, compression: "BC1" });
    expect(Array.from(image.pixels.slice(0, 16))).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
      170, 85, 0, 255,
      85, 170, 0, 255,
    ]);
  });

  it("decodes BC3 alpha endpoints and three-bit selectors", () => {
    const block = new Uint8Array(16);
    block[0] = 255;
    block[1] = 0;
    let alphaSelectors = 0n;
    for (let index = 0; index < 16; index += 1) alphaSelectors |= BigInt(index % 8) << BigInt(index * 3);
    for (let index = 0; index < 6; index += 1) block[2 + index] = Number((alphaSelectors >> BigInt(index * 8)) & 0xffn);
    const view = new DataView(block.buffer);
    view.setUint16(8, 0x001f, true);
    view.setUint16(10, 0x001f, true);

    const image = decodeNativeBlp(makeBlp(8, 7, block), 1002);

    expect(image.compression).toBe("BC3");
    expect(Array.from(image.pixels.slice(0, 16))).toEqual([
      0, 0, 255, 255,
      0, 0, 255, 0,
      0, 0, 255, 218,
      0, 0, 255, 182,
    ]);
  });

  it("rejects unsupported encodings, partial mip payloads, and invalid dimensions", () => {
    const unsupported = makeBlp(8, 7, new Uint8Array(16));
    new Uint8Array(unsupported)[8] = 1;
    expect(() => decodeNativeBlp(unsupported, 20)).toThrow(/FileDataID 20.*encoding 1.*unsupported/i);

    const partial = makeBlp(8, 7, new Uint8Array(15));
    expect(() => decodeNativeBlp(partial, 21)).toThrow(/FileDataID 21.*mip.*16 bytes.*15/i);

    const invalidDimensions = makeBlp(0, 0, new Uint8Array(8));
    new DataView(invalidDimensions).setUint32(12, 0, true);
    expect(() => decodeNativeBlp(invalidDimensions, 22)).toThrow(/FileDataID 22.*dimensions/i);
  });
});

describe("prepared original BLP assets", () => {
  it.each([
    [397894, 256, 256, "BC3"],
    [796153, 256, 256, "BC1"],
    [243229, 16, 16, "BC3"],
    [669041, 256, 256, "BC1"],
    [613804, 64, 64, "BC3"],
    [613805, 64, 64, "BC3"],
    [613806, 128, 128, "BC3"],
    [167020, 512, 512, "BC3"],
    [167034, 64, 64, "BC1"],
  ])("decodes original FileDataID %i", async (fileDataId, width, height, compression) => {
    const { existsSync, readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const url = resolve(process.cwd(), `public/model/native-effects/${fileDataId}.blp`);
    if (!existsSync(url)) throw new Error("Native assets are missing. Run node script/prepare-native-effects.mjs.");
    const bytes = readFileSync(url);
    const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);

    const decoded = decodeNativeBlp(source, fileDataId);

    expect(decoded).toMatchObject({ width, height, compression });
    expect(decoded.pixels.some((value) => value !== 0)).toBe(true);
  });
});


describe("new original preview BLP assets", () => {
  const textureIds = [...new Set(NATIVE_EFFECT_ASSETS.filter((asset) =>
    asset.fileDataId !== 4290517 && asset.fileDataId !== 794788 && asset.fileDataId !== 613807).flatMap((asset) =>
    asset.textures.map((texture) => texture.fileDataId)))];

  it("decodes all 48 pinned original textures as BC1 or BC3", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    expect(textureIds).toHaveLength(48);
    const compressionCounts = { BC1: 0, BC3: 0 };
    for (const fileDataId of textureIds) {
      const bytes = readFileSync(resolve(process.cwd(), `public/model/native-effects/${fileDataId}.blp`));
      const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const image = decodeNativeBlp(source, fileDataId);
      expect(image.width * image.height * 4).toBe(image.pixels.length);
      compressionCounts[image.compression] += 1;
    }
    expect(compressionCounts).toEqual({ BC1: 6, BC3: 42 });
  });

  it("decodes the seven newly pinned original mesh textures without replacing the shared eighth", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const meshTextures = NATIVE_EFFECT_ASSETS.find((asset) => asset.fileDataId === 4290517)!.textures;
    const newTextureIds = meshTextures.map((texture) => texture.fileDataId).filter((fileDataId) => !textureIds.includes(fileDataId));
    expect(meshTextures).toHaveLength(8);
    expect(newTextureIds).toHaveLength(7);
    for (const fileDataId of newTextureIds) {
      const bytes = readFileSync(resolve(process.cwd(), `public/model/native-effects/${fileDataId}.blp`));
      const source = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      const image = decodeNativeBlp(source, fileDataId);
      expect(image.width * image.height * 4).toBe(image.pixels.length);
      expect(["BC1", "BC3"]).toContain(image.compression);
    }
  });
});
