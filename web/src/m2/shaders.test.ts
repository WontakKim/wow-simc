import { describe, expect, it } from "vitest";
import previewStageJson from "../previewStage.json";
import { parsePreviewStage } from "./previewStage";
import { M2_VERTEX_SHADER_SOURCE } from "./shaderSource";

describe("pinned outdoor LightData preview", () => {
  it("decodes BGRA daylight and records the source row/time without inventing missing ambient channels", () => {
    const stage = parsePreviewStage(previewStageJson);
    expect(stage.source).toMatchObject({ build: "12.1.0.69933", lightId: 1, lightParamsId: 12, lightDataId: 20977, time: 1440 });
    expect(stage.sky.top).toEqual([0, 0x1f / 255, 0x49 / 255]);
    expect(stage.lighting.ambientHorizon).toEqual(stage.lighting.ambientSky);
    expect(stage.lighting.ambientGround).toEqual(stage.lighting.ambientSky);
    expect(stage.fog.end).toBe(18000);
    expect(stage.fog.density).toBe(4.5);
  });
  it("rejects missing provenance or invalid colors", () => {
    expect(() => parsePreviewStage({ ...previewStageJson, source: { ...previewStageJson.source, lightDataId: 0 } })).toThrow();
    expect(() => parsePreviewStage({ ...previewStageJson, source: { ...previewStageJson.source, csvSha256: {} } })).toThrow();
    expect(() => parsePreviewStage({ ...previewStageJson, colors: { ...previewStageJson.colors, skyTop: -1 } })).toThrow();
  });
});
import {
  M2_ALPHA_KEY,
  M2_INDEXED_SHADER_PAIRS,
  M2_PIXEL_SHADER_NAMES,
  M2_VERTEX_SHADER_NAMES,
  M2_PREVIEW_LIGHT_PRESET,
  UNSUPPORTED_M2_PIXEL_SHADERS,
  UNSUPPORTED_M2_VERTEX_SHADERS,
  computeM2FinalOpacity,
  evaluateM2Lighting,
  evaluateM2PixelCombiner,
  selectM2Shaders,
  type M2CombinerInputs,
  type M2LightPreset,
} from "./shaders";

describe("environment-coordinate pole", () => {
  it("maps a zero projection denominator to the finite texture center", () => {
    expect(M2_VERTEX_SHADER_SOURCE).toMatch(/if \(m == 0\.0\) return vec2\(0\.5\);/);
  });
});

describe("selectM2Shaders", () => {
  // Indexed table, research/rendering/m2-format-and-rendering.md section 7:
  // 36 rows of (vertex shader id, pixel combiner id), reached when 0x8000 is set.
  const INDEXED_PAIRS: Array<[number, number]> = [
    [3, 12], [3, 13], [3, 14], [6, 15], [3, 16], [7, 13], [7, 16], [3, 17], [3, 18],
    [6, 19], [7, 20], [3, 21], [3, 22], [3, 23], [7, 23], [2, 20], [3, 24], [6, 25],
    [0, 26], [9, 33], [11, 27], [12, 6], [2, 28], [7, 29], [11, 25], [13, 33], [14, 30],
    [2, 31], [14, 32], [7, 34], [15, 35], [16, 35], [0, 0], [12, 7], [9, 1], [12, 36],
  ];

  it("exposes the full 36-row indexed shader table", () => {
    expect(M2_INDEXED_SHADER_PAIRS).toEqual(INDEXED_PAIRS);
  });

  it.each(INDEXED_PAIRS.map(([vs, ps], row) => [row, vs, ps] as const))(
    "resolves indexed shader 0x%x to VS %i / PS %i",
    (row, vs, ps) => {
      const selection = selectM2Shaders(0x8000 | row, 2);
      expect(selection).toMatchObject({ vertexShader: vs, pixelShader: ps, source: "indexed" });
      // Rows 29-31 carry the gated variants; they must be reported, not hidden.
      expect(selection.unsupportedVertexShader).toBe(UNSUPPORTED_M2_VERTEX_SHADERS.has(vs) ? vs : null);
      expect(selection.unsupportedPixelShader).toBe(UNSUPPORTED_M2_PIXEL_SHADERS.has(ps) ? ps : null);
    },
  );

  it("uses the legacy single-texture selection below 0x8000", () => {
    expect(selectM2Shaders(0x0, 1)).toMatchObject({ vertexShader: 0, pixelShader: 0, source: "legacy" });
    expect(selectM2Shaders(0x10, 1)).toMatchObject({ vertexShader: 0, pixelShader: 1 });
    expect(selectM2Shaders(0x14, 1)).toMatchObject({ vertexShader: 0, pixelShader: 1 });
    expect(selectM2Shaders(0x80, 1)).toMatchObject({ vertexShader: 1, pixelShader: 0 });
    expect(selectM2Shaders(0x90, 1)).toMatchObject({ vertexShader: 1, pixelShader: 1 });
    expect(selectM2Shaders(0x4000, 1)).toMatchObject({ vertexShader: 10, pixelShader: 0 });
  });

  it("uses the legacy multi-texture selection below 0x8000", () => {
    expect(selectM2Shaders(0x11, 2)).toMatchObject({ vertexShader: 7, pixelShader: 6 });
    expect(selectM2Shaders(0x14, 2)).toMatchObject({ vertexShader: 7, pixelShader: 7 });
    expect(selectM2Shaders(0x4011, 2)).toMatchObject({ vertexShader: 2, pixelShader: 6 });
    expect(selectM2Shaders(0x4013, 2)).toMatchObject({ vertexShader: 2, pixelShader: 8 });
    expect(selectM2Shaders(0x4014, 2)).toMatchObject({ vertexShader: 2, pixelShader: 7 });
    expect(selectM2Shaders(0x8, 2)).toMatchObject({ vertexShader: 3, pixelShader: 5 });
    expect(selectM2Shaders(0x88, 2)).toMatchObject({ vertexShader: 5, pixelShader: 5 });
  });

  it("resolves 0x8021 through the indexed table to VS12/PS7 regardless of texture count", () => {
    expect(selectM2Shaders(0x8021, 2)).toMatchObject({ vertexShader: 12, pixelShader: 7, source: "indexed" });
  });

  it("diagnoses unsupported vertex shaders 15, 16 and 18 instead of selecting them silently", () => {
    expect([...UNSUPPORTED_M2_VERTEX_SHADERS].sort((a, b) => a - b)).toEqual([15, 16, 18]);
    expect(selectM2Shaders(0x8000 | 30, 3).unsupportedVertexShader).toBe(15);
    expect(selectM2Shaders(0x8000 | 31, 3).unsupportedVertexShader).toBe(16);
    expect(selectM2Shaders(0x8000 | 30, 3).vertexShader).toBe(15);
  });

  it("diagnoses the unsupported Illum pixel combiner 34 instead of rendering it opaque", () => {
    expect([...UNSUPPORTED_M2_PIXEL_SHADERS]).toEqual([34]);
    expect(selectM2Shaders(0x8000 | 29, 1)).toMatchObject({ pixelShader: 34, unsupportedPixelShader: 34 });
  });

  it("names every shader variant", () => {
    expect(M2_VERTEX_SHADER_NAMES).toHaveLength(19);
    expect(M2_VERTEX_SHADER_NAMES[0]).toBe("Diffuse_T1");
    expect(M2_VERTEX_SHADER_NAMES[15]).toBe("Diffuse_T1_T2_T3");
    expect(M2_VERTEX_SHADER_NAMES[18]).toBe("BW_Diffuse_T1_T2");
    expect(M2_PIXEL_SHADER_NAMES).toHaveLength(37);
    expect(M2_PIXEL_SHADER_NAMES[0]).toBe("Combiners_Opaque");
    expect(M2_PIXEL_SHADER_NAMES[34]).toBe("Illum");
    expect(M2_PIXEL_SHADER_NAMES[36]).toBe("Combiners_Mod_Mod_Depth");
  });
});

function combinerInputs(overrides: Partial<M2CombinerInputs> = {}): M2CombinerInputs {
  return {
    meshColor: [0.9, 0.8, 0.7],
    tex1: { rgb: [1.0, 0.5, 0.25], alpha: 0.75 },
    tex2: { rgb: [0.2, 0.4, 0.6], alpha: 0.5 },
    tex3: { rgb: [0.1, 0.9, 0.3], alpha: 0.25 },
    tex4Alpha: 0.8,
    weights: [0.3, 0.6, 0.9],
    ...overrides,
  };
}

describe("evaluateM2PixelCombiner", () => {
  it.each([
    // [pixel shader, matDiffuse, specular, discardAlpha, canDiscard]
    [0, [0.9, 0.4, 0.175], [0, 0, 0], 1, false],
    [1, [0.9, 0.4, 0.175], [0, 0, 0], 0.75, true],
    [3, [0.36, 0.32, 0.21], [0, 0, 0], 1.0, true],
    [5, [0.18, 0.16, 0.105], [0, 0, 0], 1, false],
    [6, [0.18, 0.16, 0.105], [0, 0, 0], 0.375, true],
    [7, [0.36, 0.32, 0.21], [0, 0, 0], 0.75, true],
    [8, [0.9, 0.4, 0.175], [0.2, 0.4, 0.6], 1.25, true],
    [12, [0.765, 0.38, 0.18375], [0, 0, 0], 1, false],
    [13, [0.9, 0.4, 0.175], [0.1, 0.2, 0.3], 1, false],
    [17, [0.9, 0.4, 0.175], [0.025, 0.05, 0.075], 0.931, true],
    [21, [0.9, 0.4, 0.175], [0.05, 0.1, 0.15], 1.25, true],
    [24, [0.54, 0.36, 0.2975], [0.225, 0.1125, 0.05625], 1, false],
    [26, [0.9 * 0.142, 0.8 * 0.854, 0.7 * 0.316], [0, 0, 0], 0.285, true],
    [29, [0.54, 0.36, 0.2975], [0, 0, 0], 1, false],
    [32, [0.4275, 0.39, 0.1575], [0, 0, 0], 1, false],
    [35, [0.018, 0.144, 0.0315], [0, 0, 0], 0.09375, true],
    [36, [0.18, 0.16, 0.105], [0, 0, 0], 0.375, true],
  ] as const)("evaluates PS%i against the reference equations", (ps, matDiffuse, specular, discardAlpha, canDiscard) => {
    const result = evaluateM2PixelCombiner(ps, combinerInputs());
    for (let channel = 0; channel < 3; channel += 1) {
      expect(result.matDiffuse[channel]).toBeCloseTo(matDiffuse[channel], 5);
      expect(result.specular[channel]).toBeCloseTo(specular[channel], 5);
    }
    expect(result.discardAlpha).toBeCloseTo(discardAlpha, 5);
    expect(result.canDiscard).toBe(canDiscard);
  });

  it("collapses tex4 alpha into the masked dual crossfade (PS28)", () => {
    const result = evaluateM2PixelCombiner(28, combinerInputs());
    expect(result.discardAlpha).toBeCloseTo(0.285 * 0.8, 5);
    expect(result.matDiffuse[1]).toBeCloseTo(0.8 * 0.854, 5);
  });

  it("throws a diagnosis instead of evaluating the unsupported Illum combiner", () => {
    expect(() => evaluateM2PixelCombiner(34, combinerInputs())).toThrow(/PS34|Illum/);
  });
});

describe("computeM2FinalOpacity", () => {
  it("keeps opaque and alpha-key at mesh opacity and discards below the alpha key for blend 1", () => {
    expect(computeM2FinalOpacity(0, { discardAlpha: 0.2, canDiscard: true }, 0.5))
      .toEqual({ opacity: 0.5, discard: false });
    expect(computeM2FinalOpacity(1, { discardAlpha: 0.2, canDiscard: true }, 0.5))
      .toEqual({ opacity: 0.5, discard: true });
    expect(computeM2FinalOpacity(1, { discardAlpha: 0.9, canDiscard: true }, 0.5))
      .toEqual({ opacity: 0.5, discard: false });
    expect(computeM2FinalOpacity(1, { discardAlpha: 0.2, canDiscard: false }, 0.5))
      .toEqual({ opacity: 0.5, discard: false });
  });

  it.each([
    [0, 0.5, false], // Opaque
    [1, 0.5, true], // AlphaKey
    [2, 0.125, false], // Alpha
    [3, 0.125, false], // NoAlphaAdd
    [4, 0.125, false], // Add
    [5, 0.125, true], // Mod
    [6, 0.125, true], // Mod2x
    [7, 0.125, false], // BlendAdd
  ])("uses raw blend %i for low-alpha opacity and discard", (blendMode, opacity, discard) => {
    expect(computeM2FinalOpacity(blendMode, { discardAlpha: 0.25, canDiscard: true }, 0.5))
      .toEqual({ opacity, discard });
  });

  it.each([1, 5, 6])("keeps raw blend %i at the alpha key and when the combiner cannot discard", (blendMode) => {
    expect(computeM2FinalOpacity(blendMode, { discardAlpha: M2_ALPHA_KEY, canDiscard: true }, 0.5).discard)
      .toBe(false);
    expect(computeM2FinalOpacity(blendMode, { discardAlpha: 0.25, canDiscard: false }, 0.5).discard)
      .toBe(false);
  });
});

describe("evaluateM2Lighting", () => {
  const preset: M2LightPreset = {
    name: "test preset",
    ambientSky: [0.1, 0.2, 0.3],
    ambientHorizon: [0.4, 0.5, 0.6],
    ambientGround: [0.7, 0.8, 0.9],
    sunColor: [1, 1, 1],
    sunDirectionNative: [0, 1, 0],
    localLight: [0.01, 0.02, 0.03],
    unlitAdd: [0.05, 0, 0],
  };
  const diffuse: [number, number, number] = [0.5, 0.5, 0.5];

  const shade = (ambient: number[], nDotL: number) =>
    ambient.map((a, channel) => {
      const g = diffuse[channel] * (a + nDotL);
      const local = diffuse[channel] * diffuse[channel] * preset.localLight[channel];
      return Math.sqrt(g * g + local) + preset.unlitAdd[channel];
    });

  it("uses the sky ambient for up-facing normals", () => {
    expect(evaluateM2Lighting(diffuse, [0, 0, 1], preset)).toEqual(shade(preset.ambientSky, 0));
  });

  it("uses the ground ambient for down-facing normals", () => {
    expect(evaluateM2Lighting(diffuse, [0, 0, -1], preset)).toEqual(shade(preset.ambientGround, 0));
  });

  it("blends to the horizon band at grazing normals and adds the sun term", () => {
    expect(evaluateM2Lighting(diffuse, [1, 0, 0], preset)).toEqual(shade(preset.ambientHorizon, 0));
    expect(evaluateM2Lighting(diffuse, [0, 1, 0], preset)).toEqual(shade(preset.ambientHorizon, 1));
  });

  it("bypasses lighting entirely for unlit materials", () => {
    expect(evaluateM2Lighting(diffuse, [0, 1, 0], preset, { unlit: true })).toEqual(diffuse);
  });

  it("ships a recorded preview preset instead of claiming a real zone", () => {
    expect(M2_PREVIEW_LIGHT_PRESET.name.toLowerCase()).toContain("preview");
    for (const value of [
      M2_PREVIEW_LIGHT_PRESET.ambientSky,
      M2_PREVIEW_LIGHT_PRESET.ambientHorizon,
      M2_PREVIEW_LIGHT_PRESET.ambientGround,
      M2_PREVIEW_LIGHT_PRESET.sunColor,
      M2_PREVIEW_LIGHT_PRESET.sunDirectionNative,
    ]) {
      expect(value).toHaveLength(3);
      expect(value.every((component) => Number.isFinite(component))).toBe(true);
    }
  });
});
