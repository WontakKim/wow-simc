// M2 shader selection and material math shared by the WebGL renderer and its
// tests: the 36-row indexed shader table plus the legacy fallback selection
// (ported from wow.export ShaderMapper, MIT), the 37 pixel combiners as a CPU
// twin of the generated GLSL, final-opacity rules per blend mode, and the WoW
// lighting model evaluated against a recorded preview light preset.
//
// Color-domain policy: BLP bytes are display-domain values here. Textures are
// sampled without an sRGB internal format and the combiner output reaches the
// canvas without a tonemap or output encode; do not mix these materials with
// sRGB-decoding textures or post-processing.

export const M2_VERTEX_SHADER_NAMES: readonly string[] = [
  "Diffuse_T1", "Diffuse_Env", "Diffuse_T1_T2", "Diffuse_T1_Env", "Diffuse_Env_T1",
  "Diffuse_Env_Env", "Diffuse_T1_Env_T1", "Diffuse_T1_T1", "Diffuse_T1_T1_T1",
  "Diffuse_EdgeFade_T1", "Diffuse_T2", "Diffuse_T1_Env_T2", "Diffuse_EdgeFade_T1_T2",
  "Diffuse_EdgeFade_Env", "Diffuse_T1_T2_T1", "Diffuse_T1_T2_T3", "Color_T1_T2_T3",
  "BW_Diffuse_T1", "BW_Diffuse_T1_T2",
];

export const M2_PIXEL_SHADER_NAMES: readonly string[] = [
  "Combiners_Opaque", "Combiners_Mod", "Combiners_Opaque_Mod", "Combiners_Opaque_Mod2x",
  "Combiners_Opaque_Mod2xNA", "Combiners_Opaque_Opaque", "Combiners_Mod_Mod",
  "Combiners_Mod_Mod2x", "Combiners_Mod_Add", "Combiners_Mod_Mod2xNA", "Combiners_Mod_AddNA",
  "Combiners_Mod_Opaque", "Combiners_Opaque_Mod2xNA_Alpha", "Combiners_Opaque_AddAlpha",
  "Combiners_Opaque_AddAlpha_Alpha", "Combiners_Opaque_Mod2xNA_Alpha_Add", "Combiners_Mod_AddAlpha",
  "Combiners_Mod_AddAlpha_Alpha", "Combiners_Opaque_Alpha_Alpha", "Combiners_Opaque_Mod2xNA_Alpha_3s",
  "Combiners_Opaque_AddAlpha_Wgt", "Combiners_Mod_Add_Alpha", "Combiners_Opaque_ModNA_Alpha",
  "Combiners_Mod_AddAlpha_Wgt", "Combiners_Opaque_Mod_Add_Wgt", "Combiners_Opaque_Mod2xNA_Alpha_UnshAlpha",
  "Combiners_Mod_Dual_Crossfade", "Combiners_Opaque_Mod2xNA_Alpha_Alpha",
  "Combiners_Mod_Masked_Dual_Crossfade", "Combiners_Opaque_Alpha", "Guild", "Guild_NoBorder",
  "Guild_Opaque", "Combiners_Mod_Depth", "Illum", "Combiners_Mod_Mod_Mod_Const",
  "Combiners_Mod_Mod_Depth",
];

/** Indexed rows (shader ids with 0x8000 set): [vertex shader id, pixel combiner id]. */
export const M2_INDEXED_SHADER_PAIRS: ReadonlyArray<readonly [number, number]> = [
  [3, 12], [3, 13], [3, 14], [6, 15], [3, 16], [7, 13], [7, 16], [3, 17], [3, 18],
  [6, 19], [7, 20], [3, 21], [3, 22], [3, 23], [7, 23], [2, 20], [3, 24], [6, 25],
  [0, 26], [9, 33], [11, 27], [12, 6], [2, 28], [7, 29], [11, 25], [13, 33], [14, 30],
  [2, 31], [14, 32], [7, 34], [15, 35], [16, 35], [0, 0], [12, 7], [9, 1], [12, 36],
];

/** Vertex variants gated behind a visible fallback: three-texture and black&white paths. */
export const UNSUPPORTED_M2_VERTEX_SHADERS: ReadonlySet<number> = new Set([15, 16, 18]);
/** The Illum combiner is documented as incomplete in the references; never render it opaque. */
export const UNSUPPORTED_M2_PIXEL_SHADERS: ReadonlySet<number> = new Set([34]);

export interface M2ShaderSelection {
  vertexShader: number;
  pixelShader: number;
  unsupportedVertexShader: number | null;
  unsupportedPixelShader: number | null;
  source: "indexed" | "legacy";
}

function legacyVertexShader(shaderId: number, textureCount: number): number {
  if (textureCount === 1) {
    if (shaderId & 0x80) return 1; // Diffuse_Env
    return shaderId & 0x4000 ? 10 : 0; // Diffuse_T2 : Diffuse_T1
  }
  if (shaderId & 0x80) return shaderId & 0x8 ? 5 : 4; // Diffuse_Env_Env : Diffuse_Env_T1
  if (shaderId & 0x8) return 3; // Diffuse_T1_Env
  return shaderId & 0x4000 ? 2 : 7; // Diffuse_T1_T2 : Diffuse_T1_T1
}

function legacyPixelShader(shaderId: number, textureCount: number): number {
  if (textureCount === 1) {
    return shaderId & 0x70 ? 1 : 0; // Combiners_Mod : Combiners_Opaque
  }
  if (shaderId & 0x70) {
    switch (shaderId & 7) {
      case 3: return 8; // Combiners_Mod_Add
      case 4: return 7; // Combiners_Mod_Mod2x
      case 6: return 9; // Combiners_Mod_Mod2xNA
      case 7: return 10; // Combiners_Mod_AddNA
      default: return 6; // Combiners_Mod_Mod
    }
  }
  switch (shaderId & 7) {
    case 0: return 5; // Combiners_Opaque_Opaque
    case 3:
    case 7: return 13; // Combiners_Opaque_AddAlpha
    case 4: return 3; // Combiners_Opaque_Mod2x
    case 6: return 4; // Combiners_Opaque_Mod2xNA
    default: return 2; // Combiners_Opaque_Mod
  }
}

/**
 * Resolves an M2 skin batch shader id to its vertex variant and pixel
 * combiner. Ids with 0x8000 set index the 36-row table; everything else uses
 * the legacy bit-flag selection over the texture count. Unsupported variants
 * are reported, never silently substituted.
 */
export function selectM2Shaders(shaderId: number, textureCount: number): M2ShaderSelection {
  let vertexShader: number;
  let pixelShader: number;
  let source: "indexed" | "legacy";
  if (shaderId & 0x8000) {
    const row = shaderId & 0x7fff;
    if (row >= M2_INDEXED_SHADER_PAIRS.length) {
      throw new Error(`Unknown indexed shader id 0x${shaderId.toString(16)} (row ${row}).`);
    }
    [vertexShader, pixelShader] = M2_INDEXED_SHADER_PAIRS[row];
    source = "indexed";
  } else {
    vertexShader = legacyVertexShader(shaderId, textureCount);
    pixelShader = legacyPixelShader(shaderId, textureCount);
    source = "legacy";
  }
  return {
    vertexShader,
    pixelShader,
    unsupportedVertexShader: UNSUPPORTED_M2_VERTEX_SHADERS.has(vertexShader) ? vertexShader : null,
    unsupportedPixelShader: UNSUPPORTED_M2_PIXEL_SHADERS.has(pixelShader) ? pixelShader : null,
    source,
  };
}

export interface M2CombinerTextureSample {
  rgb: [number, number, number];
  alpha: number;
}

export interface M2CombinerInputs {
  meshColor: [number, number, number];
  tex1: M2CombinerTextureSample;
  tex2: M2CombinerTextureSample;
  tex3: M2CombinerTextureSample;
  /** Fourth texture alpha, only consumed by the masked dual crossfade (PS28). */
  tex4Alpha: number;
  /** Texture weight lookups (u_tex_sample_alpha in the shader). */
  weights: [number, number, number];
}

export interface M2CombinerResult {
  matDiffuse: [number, number, number];
  specular: [number, number, number];
  discardAlpha: number;
  canDiscard: boolean;
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const mix3 = (a: [number, number, number], b: [number, number, number], t: number): [number, number, number] =>
  [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scale3 = (a: [number, number, number], f: number): [number, number, number] =>
  [a[0] * f, a[1] * f, a[2] * f];
const mul3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
const add3 = (a: [number, number, number], b: [number, number, number]): [number, number, number] =>
  [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/**
 * CPU twin of the generated pixel combiner GLSL. Throws for the unsupported
 * Illum combiner so an unsupported batch can be diagnosed, not silently drawn.
 */
export function evaluateM2PixelCombiner(pixelShader: number, inputs: M2CombinerInputs): M2CombinerResult {
  const M = inputs.meshColor;
  const a = inputs.tex1.rgb;
  const x = inputs.tex1.alpha;
  const b = inputs.tex2.rgb;
  const y = inputs.tex2.alpha;
  const c = inputs.tex3.rgb;
  const z = inputs.tex3.alpha;
  const [w1, w2, w3] = inputs.weights;
  const none: [number, number, number] = [0, 0, 0];
  const base = (): M2CombinerResult => ({
    matDiffuse: mul3(M, a), specular: none, discardAlpha: 1, canDiscard: false,
  });

  switch (pixelShader) {
    case 0: return base();
    case 1: return { ...base(), discardAlpha: x, canDiscard: true };
    case 2: return { matDiffuse: mul3(mul3(M, a), b), specular: none, discardAlpha: y, canDiscard: true };
    case 3: return {
      matDiffuse: scale3(mul3(mul3(M, a), b), 2), specular: none,
      discardAlpha: y * 2, canDiscard: true,
    };
    case 4: return { matDiffuse: scale3(mul3(mul3(M, a), b), 2), specular: none, discardAlpha: 1, canDiscard: false };
    case 5: return { matDiffuse: mul3(mul3(M, a), b), specular: none, discardAlpha: 1, canDiscard: false };
    case 6: return {
      matDiffuse: mul3(mul3(M, a), b), specular: none,
      discardAlpha: x * y, canDiscard: true,
    };
    case 7: return {
      matDiffuse: scale3(mul3(mul3(M, a), b), 2), specular: none,
      discardAlpha: x * y * 2, canDiscard: true,
    };
    case 8: return {
      matDiffuse: mul3(M, a), specular: b,
      discardAlpha: x + y, canDiscard: true,
    };
    case 9: return {
      matDiffuse: scale3(mul3(mul3(M, a), b), 2), specular: none,
      discardAlpha: x, canDiscard: true,
    };
    case 10: return { matDiffuse: mul3(M, a), specular: b, discardAlpha: x, canDiscard: true };
    case 11: return {
      matDiffuse: mul3(mul3(M, a), b), specular: none,
      discardAlpha: x, canDiscard: true,
    };
    case 12: return {
      matDiffuse: mul3(M, mix3(scale3(mul3(a, b), 2), a, x)), specular: none,
      discardAlpha: 1, canDiscard: false,
    };
    case 13: return { matDiffuse: mul3(M, a), specular: scale3(b, y), discardAlpha: 1, canDiscard: false };
    case 14: return {
      matDiffuse: mul3(M, a), specular: scale3(b, y * (1 - x)),
      discardAlpha: 1, canDiscard: false,
    };
    case 15: return {
      matDiffuse: mul3(M, mix3(scale3(mul3(a, b), 2), a, x)),
      specular: scale3(c, z * w3), discardAlpha: 1, canDiscard: false,
    };
    case 16: return {
      matDiffuse: mul3(M, a), specular: scale3(b, y),
      discardAlpha: x, canDiscard: true,
    };
    case 17: return {
      matDiffuse: mul3(M, a),
      specular: scale3(b, y * (1 - x)),
      discardAlpha: x + y * (0.3 * b[0] + 0.59 * b[1] + 0.11 * b[2]),
      canDiscard: true,
    };
    case 18: return {
      matDiffuse: mul3(M, mix3(mix3(a, b, y), a, x)), specular: none,
      discardAlpha: 1, canDiscard: false,
    };
    case 19: return {
      matDiffuse: mul3(M, mix3(scale3(mul3(a, b), 2), c, z)), specular: none,
      discardAlpha: 1, canDiscard: false,
    };
    case 20: return {
      matDiffuse: mul3(M, a), specular: scale3(b, y * w2),
      discardAlpha: 1, canDiscard: false,
    };
    case 21: return {
      matDiffuse: mul3(M, a), specular: scale3(b, 1 - x),
      discardAlpha: x + y, canDiscard: true,
    };
    case 22: return {
      matDiffuse: mul3(M, mix3(mul3(a, b), a, x)), specular: none,
      discardAlpha: 1, canDiscard: false,
    };
    case 23: return {
      matDiffuse: mul3(M, a), specular: scale3(b, y * w2),
      discardAlpha: x, canDiscard: true,
    };
    case 24: return {
      matDiffuse: mul3(M, mix3(a, b, y)), specular: scale3(a, x * w1),
      discardAlpha: 1, canDiscard: false,
    };
    case 25: {
      const glowOpacity = Math.max(0, Math.min(1, z * w3));
      return {
        matDiffuse: scale3(mul3(M, mix3(scale3(mul3(a, b), 2), a, x)), 1 - glowOpacity),
        specular: scale3(c, glowOpacity),
        discardAlpha: 1, canDiscard: false,
      };
    }
    case 26:
    case 27:
    case 28: {
      // PS 26-28 sample all textures at uv1; the CPU twin receives the same
      // pre-collapsed samples from the caller.
      const mixAlphaAB = mix(x, y, Math.max(0, Math.min(1, w2)));
      const mixedAlpha = mix(mixAlphaAB, z, Math.max(0, Math.min(1, w3)));
      const mixedRgb = mix3(mix3(a, b, Math.max(0, Math.min(1, w2))), c, Math.max(0, Math.min(1, w3)));
      if (pixelShader === 27) {
        return {
          matDiffuse: mul3(M, mix3(mix3(scale3(mul3(a, b), 2), c, z), a, x)),
          specular: none, discardAlpha: 1, canDiscard: false,
        };
      }
      return {
        matDiffuse: mul3(M, mixedRgb), specular: none,
        discardAlpha: pixelShader === 28 ? mixedAlpha * inputs.tex4Alpha : mixedAlpha,
        canDiscard: true,
      };
    }
    case 29: return {
      matDiffuse: mul3(M, mix3(a, b, y)), specular: none,
      discardAlpha: 1, canDiscard: false,
    };
    case 30:
    case 31:
    case 32: {
      // Guild tabard shaders with neutral (identity) guild constants.
      const layered = mix3([1, 1, 1], b, y);
      if (pixelShader === 31) {
        return {
          matDiffuse: mul3(mul3(M, a), layered), specular: none,
          discardAlpha: x, canDiscard: true,
        };
      }
      const diffuse = mul3(M, mix3(mul3(a, layered), c, z));
      return pixelShader === 30
        ? { matDiffuse: diffuse, specular: none, discardAlpha: x, canDiscard: true }
        : { matDiffuse: diffuse, specular: none, discardAlpha: 1, canDiscard: false };
    }
    case 33: return { ...base(), discardAlpha: x, canDiscard: true };
    case 34:
      throw new Error(
        "PS34 (Illum) is not implemented: the references mark the Illum combiner incomplete. "
        + "Render the batch with the visible unsupported fallback and diagnose it.",
      );
    case 35: return {
      matDiffuse: mul3(mul3(mul3(M, a), b), c), specular: none,
      discardAlpha: x * y * z, canDiscard: true,
    };
    case 36: return {
      matDiffuse: mul3(mul3(M, a), b), specular: none,
      discardAlpha: x * y, canDiscard: true,
    };
    default:
      throw new Error(`Unknown M2 pixel shader ${pixelShader}.`);
  }
}

/** Alpha-key threshold for blend mode 1 (and the MOD/MOD2X compat discard): 128/255. */
export const M2_ALPHA_KEY = 0.501960814;

export interface M2FinalOpacityInputs {
  discardAlpha: number;
  canDiscard: boolean;
}

export interface M2FinalOpacity {
  opacity: number;
  discard: boolean;
}

/**
 * Final fragment opacity per blend mode: opaque and alpha-key keep the mesh
 * opacity (alpha-key discards below the key), everything else multiplies the
 * combiner alpha in. MOD/MOD2X additionally discard below the alpha key so
 * near-zero source pixels cannot darken the destination (compat difference).
 */
export function computeM2FinalOpacity(
  blendMode: number,
  combiner: M2FinalOpacityInputs,
  meshOpacity: number,
): M2FinalOpacity {
  if (blendMode === 0) return { opacity: meshOpacity, discard: false };
  if (blendMode === 1) {
    return { opacity: meshOpacity, discard: combiner.canDiscard && combiner.discardAlpha < M2_ALPHA_KEY };
  }
  const opacity = combiner.discardAlpha * meshOpacity;
  if (blendMode === 5 || blendMode === 6) {
    return { opacity, discard: combiner.canDiscard && combiner.discardAlpha < M2_ALPHA_KEY };
  }
  return { opacity, discard: false };
}

export interface M2LightPreset {
  /** Recorded name; this is a preview preset, not a claim about a real zone. */
  name: string;
  ambientSky: [number, number, number];
  ambientHorizon: [number, number, number];
  ambientGround: [number, number, number];
  sunColor: [number, number, number];
  /** Unit direction from a surface toward the sun, in native M2 coordinates. */
  sunDirectionNative: [number, number, number];
  /** Accumulated local light added as D^2 inside the sqrt term. */
  localLight: [number, number, number];
  /** Constant additive term added after lighting. */
  unlitAdd: [number, number, number];
}

/**
 * Neutral exterior preview preset (named, recorded, not a real zone): slightly
 * cool sky, warm horizon and ground, one warm key sun from the front-top.
 */
export const M2_PREVIEW_LIGHT_PRESET: M2LightPreset = {
  name: "Neutral exterior preview preset",
  ambientSky: [0.42, 0.47, 0.58],
  ambientHorizon: [0.55, 0.52, 0.46],
  ambientGround: [0.32, 0.28, 0.23],
  sunColor: [0.92, 0.88, 0.80],
  sunDirectionNative: [-0.35, -0.55, 0.76],
  localLight: [0.05, 0.05, 0.06],
  unlitAdd: [0, 0, 0],
};

/**
 * WoW M2 lighting: C = sqrt((D*(A + sun*NdotL))^2 + D^2*local) + unlitAdd,
 * componentwise, with the exterior ambient A blended between sky/horizon/ground
 * by the world normal. Unlit materials (flag 0x01) bypass the whole term.
 */
export function evaluateM2Lighting(
  diffuse: [number, number, number],
  normalNative: [number, number, number],
  preset: M2LightPreset = M2_PREVIEW_LIGHT_PRESET,
  options: { unlit?: boolean } = {},
): [number, number, number] {
  if (options.unlit) return diffuse.slice() as [number, number, number];
  const length = Math.hypot(normalNative[0], normalNative[1], normalNative[2]);
  const n: [number, number, number] = length > 0
    ? [normalNative[0] / length, normalNative[1] / length, normalNative[2] / length]
    : [0, 0, 1];
  const sunLength = Math.hypot(...preset.sunDirectionNative);
  const sun: [number, number, number] = sunLength > 0
    ? [preset.sunDirectionNative[0] / sunLength, preset.sunDirectionNative[1] / sunLength, preset.sunDirectionNative[2] / sunLength]
    : [0, 0, 1];

  // Native M2 models stand on the +Z axis; the caller passes native normals
  // before the basis conversion, so the up axis here is native Z.
  const wSky = Math.max(n[2], 0);
  const wGround = Math.max(-n[2], 0);
  const wHorizon = 1 - wSky - wGround;
  const nDotL = Math.max(n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2], 0);

  return diffuse.map((component, channel) => {
    const ambientAndSun =
      wSky * preset.ambientSky[channel]
      + wHorizon * preset.ambientHorizon[channel]
      + wGround * preset.ambientGround[channel]
      + preset.sunColor[channel] * nDotL;
    const g = component * ambientAndSun;
    const local = component * component * preset.localLight[channel];
    return Math.sqrt(Math.max(g * g + local, 0)) + preset.unlitAdd[channel];
  }) as [number, number, number];
}

/** UV-index forcing for PS 26/27/28 (uv2/uv3 collapse to uv1). */
export function m2PixelShaderCollapsesUV(pixelShader: number): boolean {
  return pixelShader === 26 || pixelShader === 27 || pixelShader === 28;
}
