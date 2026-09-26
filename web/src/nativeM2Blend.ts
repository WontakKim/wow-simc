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
import type { Blending, BlendingDstFactor, BlendingSrcFactor } from "three";

export type RgbaTuple = readonly [number, number, number, number];

/** Fog destination is blend-neutral for additive and modulate passes. */
export function fogM2BlendColor(
  blendMode: number,
  source: readonly [number, number, number],
  fogColor: readonly [number, number, number],
  factor: number,
  opacity = 1,
): [number, number, number] {
  let destination: readonly number[] = fogColor;
  if (blendMode === 3 || blendMode === 4) destination = [0, 0, 0];
  if (blendMode === 5) destination = [1, 1, 1];
  if (blendMode === 6) destination = [0.5, 0.5, 0.5];
  if (blendMode === 7) destination = fogColor.map((channel) => channel * opacity);
  if (factor <= 0) return [...source];
  if (factor >= 1) return [...destination] as [number, number, number];
  return [0, 1, 2].map((channel) => source[channel] +
    (destination[channel] - source[channel]) * factor) as [number, number, number];
}

export interface M2BlendParams {
  blending: Blending;
  blendSrc: BlendingSrcFactor;
  blendDst: BlendingDstFactor;
  blendSrcAlpha: BlendingSrcFactor;
  blendDstAlpha: BlendingDstFactor;
}

/**
 * M2 blend modes 0..7 with the source/destination factors the original client
 * uses (GxBlend_Opaque through GxBlend_BlendAdd). Modes 0 and 1 keep blending
 * enabled with (ONE, ZERO) factors, which reproduces the disabled-blend result
 * while staying inside three.js transparent queue ordering.
 */
export function m2BlendParams(blendingMode: number): M2BlendParams {
  switch (blendingMode) {
    case 0: // Opaque
    case 1: // AlphaKey
      return {
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: ZeroFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: ZeroFactor,
      };
    case 2: // Alpha
      return {
        blending: CustomBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      };
    case 3: // NoAlphaAdd
      return {
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      };
    case 4: // Add
      return {
        blending: CustomBlending,
        blendSrc: SrcAlphaFactor,
        blendDst: OneFactor,
        blendSrcAlpha: ZeroFactor,
        blendDstAlpha: OneFactor,
      };
    case 5: // Mod
      return {
        blending: CustomBlending,
        blendSrc: DstColorFactor,
        blendDst: ZeroFactor,
        blendSrcAlpha: DstAlphaFactor,
        blendDstAlpha: ZeroFactor,
      };
    case 6: // Mod2x
      return {
        blending: CustomBlending,
        blendSrc: DstColorFactor,
        blendDst: SrcColorFactor,
        blendSrcAlpha: DstAlphaFactor,
        blendDstAlpha: SrcAlphaFactor,
      };
    case 7: // BlendAdd (premultiplied-style source over destination)
      return {
        blending: CustomBlending,
        blendSrc: OneFactor,
        blendDst: OneMinusSrcAlphaFactor,
        blendSrcAlpha: OneFactor,
        blendDstAlpha: OneMinusSrcAlphaFactor,
      };
    default:
      throw new Error(`M2 blend mode ${blendingMode} is outside the authored 0..7 range.`);
  }
}

/**
 * Evaluates one blend-mode application with the same factors three.js applies
 * on the GPU; kept as the tested CPU reference of the table above.
 */
export function applyM2Blend(blendingMode: number, source: RgbaTuple, destination: RgbaTuple): [number, number, number, number] {
  const params = m2BlendParams(blendingMode);
  const factorValue = (factor: number, component: number) => {
    switch (factor) {
      case OneFactor: return 1;
      case ZeroFactor: return 0;
      case SrcAlphaFactor: return source[3];
      case OneMinusSrcAlphaFactor: return 1 - source[3];
      case DstColorFactor: return destination[component];
      case SrcColorFactor: return source[component];
      case DstAlphaFactor: return destination[3];
      default: throw new Error(`Blend factor ${factor} is not part of the M2 table.`);
    }
  };
  const rgb = [0, 1, 2].map((component) =>
    source[component] * factorValue(params.blendSrc, component)
    + destination[component] * factorValue(params.blendDst, component));
  const alpha = source[3] * factorValue(params.blendSrcAlpha, 3)
    + destination[3] * factorValue(params.blendDstAlpha, 3);
  return [rgb[0], rgb[1], rgb[2], alpha];
}

/**
 * Original particle alpha-test constants: opaque particles skip the test,
 * AlphaKey discards below 128/255 and every other mode below 1/255
 * (compared strictly, so an alpha exactly at the threshold survives).
 */
export function m2ParticleAlphaThreshold(blendingMode: number): number {
  if (blendingMode === 0) return -1;
  if (blendingMode === 1) return Math.fround(128 / 255);
  return Math.fround(1 / 255);
}

export interface M2RenderFlags {
  depthTest: boolean;
  depthWrite: boolean;
  twoSided: boolean;
  unlit: boolean;
  unfogged: boolean;
}

/** M2 render-flag bits: 0x1 unlit, 0x2 unfogged, 0x4 two-sided, 0x8 no depth test, 0x10 no depth write. */
export function m2RenderFlags(flags: number): M2RenderFlags {
  return {
    depthTest: (flags & 0x08) === 0,
    depthWrite: (flags & 0x10) === 0,
    twoSided: (flags & 0x04) !== 0,
    unlit: (flags & 0x01) !== 0,
    unfogged: (flags & 0x02) !== 0,
  };
}

export type ParticlePixelShaderId = 0 | 1 | 2 | 3 | 4;

/**
 * Mirrors the reference shader selection: the (MultiTexture | Refraction) flag
 * pair picks the emitter type, then the particle TXAC entry and the three-color
 * flag pick the combiner. PS3 (the nonzero-TXAC UV variant) and PS4
 * (refraction) are diagnosed as unsupported by this renderer.
 */
export function selectParticlePixelShader(flags: number, textureControlValue: number): ParticlePixelShaderId {
  const particleType = (flags & 0x10100000) === 0
    ? 0
    : (flags & 0x10000000) !== 0 ? 2 : 3;
  if (particleType === 0) return 0;
  if (particleType === 3) return 4;
  const threeColor = (flags & 0x40000000) !== 0;
  if (textureControlValue !== 0) return threeColor ? 3 : 0;
  return threeColor ? 2 : 1;
}

export interface ParticleTexelCombination {
  primary: RgbaTuple;
  secondary: RgbaTuple;
  tertiary: RgbaTuple;
  color: RgbaTuple;
  colorMultiplier: number;
  alphaMultiplier: number;
}

/**
 * CPU reference of the combiner equations the particle fragment shader mirrors:
 * PS0 modulates one texture, PS1 uses two color and three alpha textures, and
 * PS2 multiplies all three textures; EXP2 scales color and alpha afterwards.
 */
export function combineParticleTexels(
  pixelShader: 0 | 1 | 2,
  { primary, secondary, tertiary, color, colorMultiplier, alphaMultiplier }: ParticleTexelCombination,
): [number, number, number, number] {
  const rgb = pixelShader === 2
    ? [0, 1, 2].map((component) => primary[component] * secondary[component] * tertiary[component])
    : pixelShader === 1
      ? [0, 1, 2].map((component) => primary[component] * secondary[component])
      : [primary[0], primary[1], primary[2]];
  const alpha = pixelShader === 0 ? primary[3] : primary[3] * secondary[3] * tertiary[3];
  return [
    rgb[0] * color[0] * colorMultiplier,
    rgb[1] * color[1] * colorMultiplier,
    rgb[2] * color[2] * colorMultiplier,
    alpha * color[3] * alphaMultiplier,
  ];
}
