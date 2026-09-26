import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeNativeBlp } from "../nativeBlp";
import type { AtlasOperation, AtlasSourceImage, VulperaAppearance } from "./appearance";
import {
  compileGeosetVisibility,
  compositeCharacterAtlas,
  compositorBlend,
  isSupportedBlendMode,
  orderAtlasOperations,
} from "./appearance";

const ATLAS_SIZE = { width: 8, height: 8 };
const RED = [255, 0, 0, 255];
const GREEN = [0, 255, 0, 255];
const BLUE = [0, 0, 255, 255];
const WHITE = [255, 255, 255, 255];

/** 4x4 image whose four quadrants are red/green/blue/white, rows top-down. */
function fourQuadrantImage(): AtlasSourceImage {
  const pixels = new Uint8Array(4 * 4 * 4);
  const put = (x: number, y: number, rgba: number[]) => pixels.set(rgba, (y * 4 + x) * 4);
  for (let y = 0; y < 4; y += 1) {
    for (let x = 0; x < 4; x += 1) {
      put(x, y, y < 2 ? (x < 2 ? RED : GREEN) : x < 2 ? BLUE : WHITE);
    }
  }
  return { width: 4, height: 4, pixels };
}

function pixelOf(pixels: Uint8Array, width: number, x: number, y: number): number[] {
  return Array.from(pixels.subarray((y * width + x) * 4, (y * width + x) * 4 + 4));
}

function operation(overrides: Partial<AtlasOperation>): AtlasOperation {
  return {
    elementId: 1,
    choiceId: 1,
    materialId: 1,
    targetId: 1,
    layer: 0,
    textureType: 1,
    blendMode: 1,
    sourceFileDataId: 10,
    destination: { x: 0, y: 0, width: ATLAS_SIZE.width, height: ATLAS_SIZE.height },
    relatedChoiceId: null,
    ...overrides,
  };
}

describe("compositorBlend (wow.export char compositor equations, straight alpha)", () => {
  const DEST: [number, number, number, number] = [0.5, 0.5, 0.5, 1];

  it("modes 0 and 1 copy the source", () => {
    const source: [number, number, number, number] = [0.25, 0.75, 1, 0.5];
    expect(compositorBlend(0, DEST, source)).toEqual(source);
    expect(compositorBlend(1, DEST, source)).toEqual(source);
  });

  it("mode 4 multiplies, alpha-weighted by the multiplied alpha", () => {
    // F = D*S per channel including alpha, then F is drawn with its own alpha.
    const result = compositorBlend(4, [0.5, 0.5, 0.5, 1], [1, 0.5, 0.25, 0.5]);
    expect(result[0]).toBeCloseTo(0.5); // 0.5*0.5 + 0.5*0.5
    expect(result[1]).toBeCloseTo(0.375); // 0.5*0.25 + 0.5*0.5
    expect(result[2]).toBeCloseTo(0.3125); // 0.5*0.125 + 0.5*0.5
    expect(result[3]).toBeCloseTo(1); // 0.5 + 1*(1-0.5)
  });

  it("mode 6 thresholds on the source, not the destination", () => {
    const result = compositorBlend(6, [0.8, 0.2, 0.6, 1], [0.25, 0.75, 0.5, 0.5]);
    // r: S<0.5 -> 2*0.8*0.25 = 0.4; g: S>=0.5 -> 1-2*0.8*0.25 = 0.6; b: S=0.5 -> 1-2*0.4*0.5 = 0.6
    expect(result[0]).toBeCloseTo(0.6); // 0.5*0.8 + 0.5*0.4
    expect(result[1]).toBeCloseTo(0.4); // 0.5*0.2 + 0.5*0.6
    expect(result[2]).toBeCloseTo(0.6); // 0.5*0.6 + 0.5*0.6
    expect(result[3]).toBeCloseTo(1);
  });

  it("mode 7 screens", () => {
    const result = compositorBlend(7, [0.2, 0.8, 0.5, 1], [0.5, 0.5, 0.5, 1]);
    expect(result[0]).toBeCloseTo(0.6); // 1-(0.8*0.5)
    expect(result[1]).toBeCloseTo(0.9); // 1-(0.2*0.5)
    expect(result[2]).toBeCloseTo(0.75);
    expect(result[3]).toBeCloseTo(1);
  });

  it("mode 9 alpha-straight and mode 15 alpha-composite over an opaque destination", () => {
    const source: [number, number, number, number] = [1, 0.5, 0, 0.5];
    const expected = [0.75, 0.5, 0.25, 1];
    for (const mode of [9, 15]) {
      const result = compositorBlend(mode, [0.5, 0.5, 0.5, 1], source);
      expect(result, `mode ${mode}`).toEqual(expected);
    }
  });

  it("mode 15 keeps destination alpha through transparent source pixels", () => {
    const result = compositorBlend(15, [0.5, 0.5, 0.5, 1], [1, 1, 1, 0]);
    expect(result).toEqual([0.5, 0.5, 0.5, 1]);
  });

  it("mode 16 and unsupported modes fall back to ordinary alpha blending", () => {
    const expected = compositorBlend(16, DEST, [1, 0, 0, 0.5]);
    expect(expected).toEqual([0.75, 0.25, 0.25, 1]);
    expect(isSupportedBlendMode(3)).toBe(false);
    expect(compositorBlend(3, DEST, [1, 0, 0, 0.5])).toEqual(expected);
    for (const mode of [0, 1, 4, 6, 7, 9, 15, 16]) expect(isSupportedBlendMode(mode)).toBe(true);
  });
});

describe("orderAtlasOperations", () => {
  it("sorts by texture target id, matching wow.export", () => {
    const { ordered, layerOrderDisagrees } = orderAtlasOperations([
      operation({ targetId: 13, layer: 6 }),
      operation({ targetId: 1, layer: 0 }),
      operation({ targetId: 5, layer: 4 }),
    ]);
    expect(ordered.map((entry) => entry.targetId)).toEqual([1, 5, 13]);
    expect(layerOrderDisagrees).toBe(false);
  });

  it("reports when target-id order disagrees with layer order", () => {
    const { ordered, layerOrderDisagrees } = orderAtlasOperations([
      operation({ targetId: 5, layer: 7 }),
      operation({ targetId: 1, layer: 0 }),
    ]);
    expect(ordered.map((entry) => entry.targetId)).toEqual([1, 5]);
    expect(layerOrderDisagrees).toBe(false); // layers 0 -> 7 still ascend

    const conflicting = orderAtlasOperations([
      operation({ targetId: 5, layer: 0 }),
      operation({ targetId: 1, layer: 7 }),
    ]);
    expect(conflicting.ordered.map((entry) => entry.targetId)).toEqual([1, 5]);
    expect(conflicting.layerOrderDisagrees).toBe(true); // layers 7 -> 0 descend
  });
});

describe("compositeCharacterAtlas", () => {
  it("places a source into its destination rect with a top-left origin", () => {
    const image = fourQuadrantImage();
    const { pixels, diagnostics } = compositeCharacterAtlas(ATLAS_SIZE, [
      operation({ sourceFileDataId: 10, destination: { x: 2, y: 1, width: 2, height: 2 } }),
    ], new Map([[10, image]]));

    expect(diagnostics).toEqual([]);
    // Source row 0 (red/green quadrants) lands on atlas row y=1; the top-left
    // origin means Y grows downward, matching the decoded BLP row order.
    expect(pixelOf(pixels, 8, 2, 1)).toEqual(RED);
    expect(pixelOf(pixels, 8, 3, 1)).toEqual(GREEN);
    expect(pixelOf(pixels, 8, 2, 2)).toEqual(BLUE);
    expect(pixelOf(pixels, 8, 3, 2)).toEqual(WHITE);
  });

  it("magnifies a source with bilinear sampling into the rect", () => {
    const image = fourQuadrantImage();
    const { pixels } = compositeCharacterAtlas(ATLAS_SIZE, [
      operation({ sourceFileDataId: 10, destination: { x: 0, y: 0, width: 8, height: 8 } }),
    ], new Map([[10, image]]));

    // Center of the magnified image sits between all four quadrants.
    const center = pixelOf(pixels, 8, 4, 4);
    expect(center[0]).toBeGreaterThan(60); // red contributes
    expect(center[1]).toBeGreaterThan(60); // green contributes
    expect(center[2]).toBeGreaterThan(60); // blue contributes
    // Corners keep their quadrant colour after magnification.
    expect(pixelOf(pixels, 8, 0, 0)).toEqual(RED);
    expect(pixelOf(pixels, 8, 7, 7)).toEqual(WHITE);
  });

  it("starts from the neutral grey clear and blends later layers over earlier ones", () => {
    const { pixels } = compositeCharacterAtlas(ATLAS_SIZE, [
      operation({ sourceFileDataId: 10, destination: { x: 0, y: 0, width: 8, height: 8 } }),
    ], new Map());

    // No sources resolve: the atlas stays at the exporter's grey clear colour.
    expect(pixelOf(pixels, 8, 0, 0)).toEqual([128, 128, 128, 255]);
  });

  it("reports missing sources and unsupported blend modes as diagnostics", () => {
    const image = fourQuadrantImage();
    const { diagnostics } = compositeCharacterAtlas(ATLAS_SIZE, [
      operation({ sourceFileDataId: 77, destination: { x: 0, y: 0, width: 8, height: 8 } }),
      operation({ sourceFileDataId: 10, blendMode: 3, destination: { x: 0, y: 0, width: 8, height: 8 } }),
    ], new Map([[10, image]]));

    expect(diagnostics.some((line) => line.includes("77"))).toBe(true);
    expect(diagnostics.some((line) => line.includes("blend mode 3"))).toBe(true);
  });
});

describe("compileGeosetVisibility", () => {
  const appearance = {
    geosets: {
      enabledMeshPartIds: [100, 203, 4102],
      families: [
        {
          optionId: 336,
          selectedChoiceId: 3323,
          meshPartIds: [100, 202, 203, 204],
          selectedMeshPartIds: [100, 203],
        },
        {
          optionId: 338,
          selectedChoiceId: 3335,
          meshPartIds: [4101, 4102, 4103],
          selectedMeshPartIds: [4102],
        },
      ],
    },
  } as unknown as VulperaAppearance;

  it("keeps the exporter base rule outside controlled families", () => {
    const visibility = compileGeosetVisibility([0, 401, 502, 1701, 3201, 3501], appearance);
    expect(visibility.get(0)).toBe(true);
    expect(visibility.get(401)).toBe(true);
    expect(visibility.get(502)).toBe(false);
    expect(visibility.get(1701)).toBe(false);
    expect(visibility.get(3201)).toBe(true);
    expect(visibility.get(3501)).toBe(false);
  });

  it("hides family alternatives and enables every selected piece", () => {
    const visibility = compileGeosetVisibility([100, 202, 203, 204, 4101, 4102, 4103], appearance);
    expect(visibility.get(203)).toBe(true);
    expect(visibility.get(100)).toBe(true); // multiple selected pieces in one family
    expect(visibility.get(202)).toBe(false);
    expect(visibility.get(204)).toBe(false);
    expect(visibility.get(4102)).toBe(true);
    expect(visibility.get(4101)).toBe(false);
    expect(visibility.get(4103)).toBe(false);
  });

  it("lets customization override the hidden 35xx base rule when a family selects it", () => {
    const withEarrings = {
      geosets: {
        enabledMeshPartIds: [3500],
        families: [{
          optionId: 854,
          selectedChoiceId: 9581,
          meshPartIds: [3500, 3501],
          selectedMeshPartIds: [3500],
        }],
      },
    } as unknown as VulperaAppearance;
    const visibility = compileGeosetVisibility([3500, 3501], withEarrings);
    expect(visibility.get(3500)).toBe(true);
    expect(visibility.get(3501)).toBe(false);
  });
});

const MODEL_DIRECTORY = resolve(process.cwd(), "public/model/native-models");
const APPEARANCE_JSON_PATH = resolve(process.cwd(), "src/vulperaAppearance.json");

function readAppearanceJson(): VulperaAppearance | null {
  if (!existsSync(APPEARANCE_JSON_PATH)) return null;
  return JSON.parse(readFileSync(APPEARANCE_JSON_PATH, "utf8")) as VulperaAppearance;
}

const appearanceJson = readAppearanceJson();
const filesAvailable = appearanceJson !== null;

describe.skipIf(!filesAvailable)("prepared Vulpera appearance (real pinned assets)", () => {
  if (!filesAvailable) {
    console.warn("Skipping Vulpera appearance integration tests: run node script/prepare-vulpera-appearance.mjs to emit src/vulperaAppearance.json.");
  }

  const appearance = appearanceJson!;

  function readPreparedBlp(fileDataId: number): AtlasSourceImage | undefined {
    const path = resolve(MODEL_DIRECTORY, `${fileDataId}.blp`);
    if (!existsSync(path)) return undefined;
    const bytes = readFileSync(path);
    const decoded = decodeNativeBlp(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      fileDataId,
    );
    return { width: decoded.width, height: decoded.height, pixels: decoded.pixels };
  }

  it("composites the type 1 body atlas at the DB dimensions with face and snout overlays", () => {
    const skinAtlas = appearance.atlasSizes.find((size) => size.textureType === 1);
    expect(skinAtlas).toEqual({ textureType: 1, width: 2048, height: 1024 });

    const { ordered } = orderAtlasOperations(appearance.atlasOperations);
    expect(ordered.map((entry) => entry.targetId)).toEqual([1, 5, 13]);

    const sources = new Map(ordered.map((entry) => [entry.sourceFileDataId, readPreparedBlp(entry.sourceFileDataId)!]));
    const { pixels, diagnostics } = compositeCharacterAtlas(skinAtlas!, ordered, sources);
    expect(diagnostics).toEqual([]);

    const chromatic = (x: number, y: number) => {
      const [r, g, b] = pixelOf(pixels, 2048, x, y);
      return Math.max(r, g, b) - Math.min(r, g, b);
    };
    // The body fur is coloured, not the neutral grey clear (128 flat).
    let colourful = 0;
    let samples = 0;
    for (let y = 0; y < 1024; y += 16) {
      for (let x = 0; x < 1024; x += 16) {
        samples += 1;
        if (chromatic(x, y) > 16) colourful += 1;
      }
    }
    expect(colourful / samples).toBeGreaterThan(0.2);

    // The snout section (512,384,512,256) receives the target-13 overlay
    // (14.7% opaque source): the final atlas must differ from a base-only
    // composite across a measurable fraction of that rect.
    const baseOnly = compositeCharacterAtlas(skinAtlas!, ordered.slice(0, 1), sources);
    let differing = 0;
    let sampledRect = 0;
    for (let y = 384; y < 640; y += 8) {
      for (let x = 512; x < 1024; x += 8) {
        sampledRect += 1;
        if (pixelOf(pixels, 2048, x, y).some((channel, index) => Math.abs(channel - pixelOf(baseOnly.pixels, 2048, x, y)[index]) > 8)) {
          differing += 1;
        }
      }
    }
    expect(differing / sampledRect).toBeGreaterThan(0.05);

    // The face section (1024,0,1024,1024) overlay is the same art as the base
    // texture's face half (the default Face choice repaints it): the composite
    // must stay near-identical to base-only there instead of corrupting it.
    let faceDiffering = 0;
    let faceSamples = 0;
    for (let y = 0; y < 1024; y += 16) {
      for (let x = 1024; x < 2048; x += 16) {
        faceSamples += 1;
        if (pixelOf(pixels, 2048, x, y).some((channel, index) => Math.abs(channel - pixelOf(baseOnly.pixels, 2048, x, y)[index]) > 8)) {
          faceDiffering += 1;
        }
      }
    }
    expect(faceDiffering / faceSamples).toBeLessThan(0.02);
  });

  it("resolves the eye colour as a direct type 19 texture and pins its source", () => {
    const direct = appearance.directTextures.find((entry) => entry.textureType === 19);
    expect(direct).toBeDefined();
    const image = readPreparedBlp(direct!.sourceFileDataId);
    expect(image).toBeDefined();
    expect(image!.width).toBeGreaterThan(0);
  });

  it("compiles the real Vulpera skin geosets without conflicting alternatives", async () => {
    const skinPath = resolve(MODEL_DIRECTORY, "1893903.skin");
    if (!existsSync(skinPath)) {
      console.warn("Skipping geoset compile assertion: the Vulpera SKIN is not prepared.");
      return;
    }
    const bytes = readFileSync(skinPath);
    // meshPartIds live at the sections array; re-read through the real parser.
    const { parseSkinFile } = await import("./model");
    const skin = parseSkinFile(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
      1893903,
    );
    const visibility = compileGeosetVisibility(
      skin.sections.map((section) => section.meshPartId),
      appearance,
    );
    expect(visibility.get(0)).toBe(true);
    expect(visibility.get(203)).toBe(true); // Compact ears
    expect(visibility.get(202)).toBe(false); // Wanderer ears alternative
    expect(visibility.get(204)).toBe(false);
    expect(visibility.get(4102)).toBe(true); // Long snout
    expect(visibility.get(4103)).toBe(false);
    expect(visibility.get(4101)).toBe(true); // base rule: ends with 01
    expect(visibility.get(1701)).toBe(false); // 17xx stays hidden
    expect(visibility.get(3201)).toBe(true); // 32xx base rule
  });
});
