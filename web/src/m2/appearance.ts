// Character customization appearance composition. The blend equations and
// compositing order are ported from wow.export's CharMaterialRenderer and
// char.fragment.shader (MIT); the inputs come from
// script/prepare-vulpera-appearance.mjs.
import { isGeosetVisibleByDefault } from "./geosets";

export interface AtlasDestinationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One composited layer of a texture-type atlas. */
export interface AtlasOperation {
  elementId: number;
  choiceId: number;
  materialId: number;
  targetId: number;
  layer: number;
  textureType: number;
  blendMode: number;
  sourceFileDataId: number;
  destination: AtlasDestinationRect;
  relatedChoiceId: number | null;
}

/** A replaceable-slot texture bound directly from its source BLP (non-skin types). */
export interface DirectTexture {
  elementId: number;
  choiceId: number;
  materialId: number;
  targetId: number;
  relatedChoiceId: number | null;
  sourceFileDataId: number;
  textureType: number;
}

export interface AtlasSize {
  textureType: number;
  width: number;
  height: number;
}

export interface SkippedMaterial {
  materialId: number;
  reason: string;
  relatedChoiceId: number | null;
}

export interface GeosetFamily {
  optionId: number;
  selectedChoiceId: number;
  meshPartIds: number[];
  selectedMeshPartIds: number[];
}

export interface VulperaAppearance {
  build: string;
  chrModelId: number;
  charComponentTextureLayoutId: number;
  choices: { optionId: number; optionName: string; choiceId: number; choiceName: string; source: string }[];
  geosets: { enabledMeshPartIds: number[]; families: GeosetFamily[] };
  atlasOperations: AtlasOperation[];
  atlasSizes: AtlasSize[];
  skippedMaterials: SkippedMaterial[];
  directTextures: DirectTexture[];
  sources: { db2: { table: string; sha256: string }[] };
}

/** Straight-alpha RGBA source image, row 0 at the top (decoded BLP row order). */
export interface AtlasSourceImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

export interface CompositeResult {
  pixels: Uint8Array;
  diagnostics: string[];
}

/** Blend modes the wow.export compositor implements; others fall back to alpha. */
const SUPPORTED_BLEND_MODES = new Set([0, 1, 4, 6, 7, 9, 15, 16]);

export function isSupportedBlendMode(mode: number): boolean {
  return SUPPORTED_BLEND_MODES.has(mode);
}

type Rgba = [number, number, number, number];

/**
 * One compositor pass: blend the straight-alpha source over the destination
 * with the M2/wow.export equation for the mode. Modes 9 and 15 differ only in
 * premultiplied handling which is identity for straight-alpha sources, so both
 * reduce to ordinary alpha here.
 */
export function compositorBlend(mode: number, dest: Rgba, source: Rgba): Rgba {
  const [dr, dg, db, da] = dest;
  const [sr, sg, sb, sa] = source;
  switch (mode) {
    case 0:
    case 1:
      // Copy: blend disabled, the destination is replaced outright.
      return source;
    case 4: {
      // Multiply: F = D*S (including alpha), then F is drawn with its own alpha.
      const f: Rgba = [dr * sr, dg * sg, db * sb, da * sa];
      const af = f[3];
      return [
        af * f[0] + (1 - af) * dr,
        af * f[1] + (1 - af) * dg,
        af * f[2] + (1 - af) * db,
        af + da * (1 - af),
      ];
    }
    case 6: {
      // Overlay thresholding on the source channel, alpha-weighted by the source.
      const overlay = (d: number, s: number) => (s < 0.5 ? 2 * d * s : 1 - 2 * (1 - d) * (1 - s));
      const f: Rgba = [overlay(dr, sr), overlay(dg, sg), overlay(db, sb), sa];
      return [
        (1 - sa) * dr + sa * f[0],
        (1 - sa) * dg + sa * f[1],
        (1 - sa) * db + sa * f[2],
        sa + da * (1 - sa),
      ];
    }
    case 7: {
      // Screen: 1-(1-D)(1-S), alpha-weighted by the source.
      const f: Rgba = [1 - (1 - dr) * (1 - sr), 1 - (1 - dg) * (1 - sg), 1 - (1 - db) * (1 - sb), sa];
      return [
        (1 - sa) * dr + sa * f[0],
        (1 - sa) * dg + sa * f[1],
        (1 - sa) * db + sa * f[2],
        sa + da * (1 - sa),
      ];
    }
    case 9:
    case 15:
    case 16:
    default:
      // Ordinary alpha blend (SRC_ALPHA, ONE_MINUS_SRC_ALPHA).
      return [
        sa * sr + (1 - sa) * dr,
        sa * sg + (1 - sa) * dg,
        sa * sb + (1 - sa) * db,
        sa + da * (1 - sa),
      ];
  }
}

/**
 * Orders atlas operations by texture target id, the order wow.export composites
 * in. Layer order usually agrees; when it does not, the disagreement is
 * reported so the atlas can be inspected for wrong stacking.
 */
export function orderAtlasOperations(operations: AtlasOperation[]): {
  ordered: AtlasOperation[];
  layerOrderDisagrees: boolean;
} {
  const ordered = [...operations].sort((a, b) => a.targetId - b.targetId || a.layer - b.layer);
  let layerOrderDisagrees = false;
  for (let index = 1; index < ordered.length; index += 1) {
    if (ordered[index].layer < ordered[index - 1].layer) layerOrderDisagrees = true;
  }
  return { ordered, layerOrderDisagrees };
}

function sampleNearest(image: AtlasSourceImage, column: number, row: number): Rgba {
  const offset = (row * image.width + column) * 4;
  const pixels = image.pixels;
  return [pixels[offset] / 255, pixels[offset + 1] / 255, pixels[offset + 2] / 255, pixels[offset + 3] / 255];
}

/** Bilinear sample with clamp-to-edge, matching the exporter's LINEAR magnification. */
function sampleBilinear(image: AtlasSourceImage, x: number, y: number): Rgba {
  const x0f = Math.floor(x - 0.5);
  const y0f = Math.floor(y - 0.5);
  const fx = x - 0.5 - x0f;
  const fy = y - 0.5 - y0f;
  const x0 = Math.min(Math.max(x0f, 0), image.width - 1);
  const x1 = Math.min(Math.max(x0f + 1, 0), image.width - 1);
  const y0 = Math.min(Math.max(y0f, 0), image.height - 1);
  const y1 = Math.min(Math.max(y0f + 1, 0), image.height - 1);
  const mix = (a: Rgba, b: Rgba, t: number): Rgba => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
  const top = mix(sampleNearest(image, x0, y0), sampleNearest(image, x1, y0), fx);
  const bottom = mix(sampleNearest(image, x0, y1), sampleNearest(image, x1, y1), fx);
  return mix(top, bottom, fy);
}

/**
 * Composites one texture-type atlas at its DB dimensions: every operation is
 * scaled into its destination rect (top-left origin, rows top-down like the
 * decoded sources) and blended with its compositor mode. Unsupported modes and
 * missing sources are named in the diagnostics instead of failing silently.
 */
export function compositeCharacterAtlas(
  size: { width: number; height: number },
  operations: AtlasOperation[],
  sources: Map<number, AtlasSourceImage>,
): CompositeResult {
  const pixels = new Uint8Array(size.width * size.height * 4);
  // wow.export clears the render target to opaque grey before the base copy.
  for (let offset = 0; offset < pixels.length; offset += 4) {
    pixels[offset] = 128;
    pixels[offset + 1] = 128;
    pixels[offset + 2] = 128;
    pixels[offset + 3] = 255;
  }
  const diagnostics: string[] = [];
  const { ordered, layerOrderDisagrees } = orderAtlasOperations(operations);
  if (layerOrderDisagrees) {
    diagnostics.push("atlas layer order disagrees with target-id order; compositing by target id (wow.export order)");
  }

  for (const operation of ordered) {
    const image = sources.get(operation.sourceFileDataId);
    if (!image) {
      diagnostics.push(`atlas source FileDataID ${operation.sourceFileDataId} (material ${operation.materialId}) is not prepared; layer skipped`);
      continue;
    }
    if (!isSupportedBlendMode(operation.blendMode)) {
      diagnostics.push(`blend mode ${operation.blendMode} (material ${operation.materialId}) is unsupported; composited with ordinary alpha`);
    }
    const { x: dx, y: dy, width: dw, height: dh } = operation.destination;
    const magnifying = dw >= image.width && dh >= image.height;
    for (let py = 0; py < dh; py += 1) {
      const targetRow = dy + py;
      if (targetRow < 0 || targetRow >= size.height) continue;
      const sampleY = ((py + 0.5) * image.height) / dh;
      for (let px = 0; px < dw; px += 1) {
        const targetColumn = dx + px;
        if (targetColumn < 0 || targetColumn >= size.width) continue;
        const sampleX = ((px + 0.5) * image.width) / dw;
        const source = magnifying
          ? sampleBilinear(image, sampleX, sampleY)
          : sampleNearest(
            image,
            Math.min(image.width - 1, Math.floor(sampleX)),
            Math.min(image.height - 1, Math.floor(sampleY)),
          );
        const offset = (targetRow * size.width + targetColumn) * 4;
        const dest: Rgba = [
          pixels[offset] / 255,
          pixels[offset + 1] / 255,
          pixels[offset + 2] / 255,
          pixels[offset + 3] / 255,
        ];
        const blended = compositorBlend(operation.blendMode, dest, source);
        pixels[offset] = Math.round(Math.min(1, Math.max(0, blended[0])) * 255);
        pixels[offset + 1] = Math.round(Math.min(1, Math.max(0, blended[1])) * 255);
        pixels[offset + 2] = Math.round(Math.min(1, Math.max(0, blended[2])) * 255);
        pixels[offset + 3] = Math.round(Math.min(1, Math.max(0, blended[3])) * 255);
      }
    }
  }
  return { pixels, diagnostics };
}

/**
 * Mesh-part visibility for the prepared appearance: the exporter base rule
 * everywhere, then each controlled family hides its alternatives and enables
 * every selected piece (multiple selected pieces in one family are allowed).
 */
export function compileGeosetVisibility(
  meshPartIds: number[],
  appearance: Pick<VulperaAppearance, "geosets">,
): Map<number, boolean> {
  const visibility = new Map<number, boolean>();
  for (const meshPartId of meshPartIds) {
    visibility.set(meshPartId, isGeosetVisibleByDefault(meshPartId));
  }
  const selected = new Set<number>();
  const controlled = new Set<number>();
  for (const family of appearance.geosets.families) {
    for (const meshPartId of family.meshPartIds) controlled.add(meshPartId);
    for (const meshPartId of family.selectedMeshPartIds) selected.add(meshPartId);
  }
  for (const meshPartId of controlled) {
    if (visibility.has(meshPartId)) visibility.set(meshPartId, selected.has(meshPartId));
  }
  return visibility;
}
