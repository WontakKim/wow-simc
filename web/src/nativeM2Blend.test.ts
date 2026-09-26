import {
  CustomBlending,
  DstAlphaFactor,
  DstColorFactor,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  SrcColorFactor,
  ZeroFactor,
} from "three";
import { describe, expect, it } from "vitest";
import {
  applyM2Blend,
  combineParticleTexels,
  fogM2BlendColor,
  m2BlendParams,
  m2ParticleAlphaThreshold,
  m2RenderFlags,
  selectParticlePixelShader,
} from "./nativeM2Blend";

describe("fogM2BlendColor", () => {
  it("fades to each blend mode's neutral contribution", () => {
    const source: [number, number, number] = [0.8, 0.4, 0.2];
    const fog: [number, number, number] = [0.2, 0.3, 0.4];
    expect(fogM2BlendColor(3, source, fog, 1)).toEqual([0, 0, 0]);
    expect(fogM2BlendColor(4, source, fog, 1)).toEqual([0, 0, 0]);
    expect(fogM2BlendColor(5, source, fog, 1)).toEqual([1, 1, 1]);
    expect(fogM2BlendColor(6, source, fog, 1)).toEqual([0.5, 0.5, 0.5]);
    expect(fogM2BlendColor(2, source, fog, 1)).toEqual(fog);
    expect(fogM2BlendColor(7, source, fog, 1, 0.5)).toEqual([0.1, 0.15, 0.2]);
    expect(fogM2BlendColor(4, source, fog, 0)).toEqual(source);
  });
});

describe("m2BlendParams", () => {
  it("maps every authored M2 blend mode to the original GxBlend factors", () => {
    expect(m2BlendParams(0)).toEqual({
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: ZeroFactor,
    });
    expect(m2BlendParams(1)).toEqual(m2BlendParams(0));
    expect(m2BlendParams(2)).toEqual({
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
    expect(m2BlendParams(3)).toEqual({
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    expect(m2BlendParams(4)).toEqual({
      blending: CustomBlending,
      blendSrc: SrcAlphaFactor,
      blendDst: OneFactor,
      blendSrcAlpha: ZeroFactor,
      blendDstAlpha: OneFactor,
    });
    expect(m2BlendParams(5)).toEqual({
      blending: CustomBlending,
      blendSrc: DstColorFactor,
      blendDst: ZeroFactor,
      blendSrcAlpha: DstAlphaFactor,
      blendDstAlpha: ZeroFactor,
    });
    expect(m2BlendParams(6)).toEqual({
      blending: CustomBlending,
      blendSrc: DstColorFactor,
      blendDst: SrcColorFactor,
      blendSrcAlpha: DstAlphaFactor,
      blendDstAlpha: SrcAlphaFactor,
    });
    expect(m2BlendParams(7)).toEqual({
      blending: CustomBlending,
      blendSrc: OneFactor,
      blendDst: OneMinusSrcAlphaFactor,
      blendSrcAlpha: OneFactor,
      blendDstAlpha: OneMinusSrcAlphaFactor,
    });
  });

  it("rejects blend modes outside the authored 0..7 range", () => {
    expect(() => m2BlendParams(8)).toThrow(/0\.\.7/);
    expect(() => m2BlendParams(-1)).toThrow(/0\.\.7/);
  });

  it("applies BlendAdd over a destination like the original client", () => {
    const result = applyM2Blend(7, [0.6, 0.2, 0, 0.25], [0.1, 0.2, 0.3, 0.5]);
    expect(result[0]).toBeCloseTo(0.675, 5);
    expect(result[1]).toBeCloseTo(0.35, 5);
    expect(result[2]).toBeCloseTo(0.225, 5);
    expect(result[3]).toBeCloseTo(0.625, 5);
  });

  it("applies Alpha, Add and Mod factors numerically", () => {
    const alpha = applyM2Blend(2, [0.5, 0.5, 0.5, 0.5], [0.2, 0.2, 0.2, 0.2]);
    expect(alpha).toEqual([0.35, 0.35, 0.35, 0.6].map((value) => expect.closeTo(value, 5)) as number[]);

    const additive = applyM2Blend(4, [0.5, 0.5, 0.5, 0.5], [0.2, 0.2, 0.2, 0.2]);
    expect(additive[0]).toBeCloseTo(0.45, 5);
    expect(additive[3]).toBeCloseTo(0.2, 5);

    const modulated = applyM2Blend(5, [0.8, 0.8, 0.8, 1], [0.5, 0.25, 0.5, 1]);
    expect(modulated.slice(0, 3)).toEqual([0.4, 0.2, 0.4].map((value) => expect.closeTo(value, 5)) as number[]);
    expect(modulated[3]).toBeCloseTo(1, 5);
  });
});

describe("m2ParticleAlphaThreshold", () => {
  it("uses no alpha test for opaque, 128/255 for AlphaKey and 1/255 otherwise", () => {
    expect(m2ParticleAlphaThreshold(0)).toBe(-1);
    expect(m2ParticleAlphaThreshold(1)).toBe(Math.fround(128 / 255));
    for (const mode of [2, 3, 4, 5, 6, 7]) {
      expect(m2ParticleAlphaThreshold(mode)).toBe(Math.fround(1 / 255));
    }
  });
});

describe("m2RenderFlags", () => {
  it("derives depth, side, lighting and fog material flags", () => {
    expect(m2RenderFlags(0)).toEqual({
      depthTest: true,
      depthWrite: true,
      twoSided: false,
      unlit: false,
      unfogged: false,
    });
    expect(m2RenderFlags(0x1f)).toEqual({
      depthTest: false,
      depthWrite: false,
      twoSided: true,
      unlit: true,
      unfogged: true,
    });
    expect(m2RenderFlags(0x08)).toEqual({
      depthTest: false,
      depthWrite: true,
      twoSided: false,
      unlit: false,
      unfogged: false,
    });
    expect(m2RenderFlags(0x10)).toEqual({
      depthTest: true,
      depthWrite: false,
      twoSided: false,
      unlit: false,
      unfogged: false,
    });
    expect(m2RenderFlags(0x155)).toEqual({
      depthTest: true,
      depthWrite: false,
      twoSided: true,
      unlit: true,
      unfogged: false,
    });
  });
});

describe("selectParticlePixelShader", () => {
  it("selects the reference combiner from flags and the particle TXAC entry", () => {
    expect(selectParticlePixelShader(0x20021, 0)).toBe(0);
    expect(selectParticlePixelShader(0x820031, 0)).toBe(0);
    expect(selectParticlePixelShader(0x10020021, 0)).toBe(1);
    expect(selectParticlePixelShader(0x50020021, 0)).toBe(2);
    expect(selectParticlePixelShader(0x10020021, 0x0100)).toBe(0);
    expect(selectParticlePixelShader(0x50020021, 1)).toBe(3);
    expect(selectParticlePixelShader(0x100200, 0)).toBe(4);
    expect(selectParticlePixelShader(0x10100200, 0)).toBe(1);
  });
});

describe("combineParticleTexels", () => {
  const primary = [0.5, 0.5, 0.5, 0.5] as const;
  const secondary = [0.8, 0.4, 0.2, 0.5] as const;
  const tertiary = [0.5, 1, 1, 0.5] as const;
  const color = [1, 0.5, 1, 0.8] as const;

  it("multiplies only the primary texture for the mod shader", () => {
    expect(combineParticleTexels(0, {
      primary, secondary, tertiary, color, colorMultiplier: 1, alphaMultiplier: 1,
    })).toEqual([
      expect.closeTo(0.5, 5),
      expect.closeTo(0.25, 5),
      expect.closeTo(0.5, 5),
      expect.closeTo(0.4, 5),
    ]);
  });

  it("combines two color textures and three alpha textures for the 2ColorTex shader", () => {
    expect(combineParticleTexels(1, {
      primary, secondary, tertiary, color, colorMultiplier: 1, alphaMultiplier: 1,
    })).toEqual([
      expect.closeTo(0.4, 5),
      expect.closeTo(0.1, 5),
      expect.closeTo(0.1, 5),
      expect.closeTo(0.5 * 0.5 * 0.5 * 0.8, 5),
    ]);
  });

  it("combines all three textures for the 3ColorTex shader", () => {
    expect(combineParticleTexels(2, {
      primary, secondary, tertiary, color, colorMultiplier: 2, alphaMultiplier: 0.5,
    })).toEqual([
      expect.closeTo(0.5 * 0.8 * 0.5 * 2, 5),
      expect.closeTo(0.5 * 0.4 * 1 * 0.5 * 2, 5),
      expect.closeTo(0.5 * 0.2 * 1 * 1 * 2, 5),
      expect.closeTo(0.5 * 0.5 * 0.5 * 0.8 * 0.5, 5),
    ]);
  });
});
