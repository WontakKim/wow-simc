// Native M2 actor: builds three.js geometry per SKIN section (shared across
// its batches), one ShaderMaterial per batch selected from the shader id via
// ./shaders, and drives GPU skinning through a bone-matrix data texture. The
// actor stays in native M2 space; the scene converts to three space exactly
// once at the root (see ./coordinates).

import {
  BufferAttribute,
  BufferGeometry,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  FloatType,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  RepeatWrapping,
  RGBAFormat,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  Vector4,
} from "three";
import { m2BlendParams, m2RenderFlags } from "../nativeM2Blend";
import { nativeToThreePoint } from "./coordinates";
import { isGeosetVisibleByDefault } from "./geosets";
import type { M2Model, M2Skin, M2SkinBatch, M2SkinSection } from "./model";
import {
  attachmentMatrix,
  sampleM2Color,
  sampleM2TextureWeight,
  sampleTextureTransformMatrix,
  type SequenceResolution,
} from "./sampler";
import { M2_ALPHA_KEY, M2_PREVIEW_LIGHT_PRESET, selectM2Shaders, type M2LightPreset } from "./shaders";
import { M2_FRAGMENT_SHADER_SOURCE, M2_VERTEX_SHADER_SOURCE } from "./shaderSource";

const NEUTRAL_FILL = 128;
const MAX_TEXTURE_UNITS = 4;

export interface NativeM2Batch {
  batch: M2SkinBatch;
  section: M2SkinSection;
  mesh: Mesh;
  material: ShaderMaterial;
}

export interface NativeM2ActorOptions {
  model: M2Model;
  skin: M2Skin;
  label: string;
  /** Decoded BLP textures keyed by model texture slot index. */
  textures: Map<number, Texture>;
  /** Replaceable-slot bindings keyed by texture type (character customization). */
  replaceableTextures?: Map<number, Texture>;
  /** Prepared-appearance mesh part visibility; falls back to the exporter base rule. */
  geosetVisibility?: Map<number, boolean>;
  lightPreset?: M2LightPreset;
  fog?: { startPreview: number; endPreview: number; color: readonly [number, number, number] };
}

export interface NativeM2Actor {
  model: M2Model;
  skin: M2Skin;
  label: string;
  root: Group;
  batches: NativeM2Batch[];
  /** Texture types with no binding yet (customization data arrives with N3). */
  pendingTextureTypes: number[];
  statusLines: string[];
  setPose(matrices: number[][]): void;
  updateAnimatedTracks(resolution: SequenceResolution, timeMs: number): void;
  setLightPreset(preset: M2LightPreset): void;
  /** Attachment transform in native space against the last uploaded pose. */
  sampleAttachment(attachmentId: number): number[] | null;
  dispose(): void;
}

function sectionGeometry(
  section: M2SkinSection,
  shared: {
    positions: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    uvs2: Float32Array;
    skinIndices: Float32Array;
    skinWeights: Float32Array;
  },
  indices: number[],
): BufferGeometry {
  const geometry = new BufferGeometry();
  const view = (array: Float32Array, itemSize: number) =>
    new BufferAttribute(
      array.subarray(section.vertexStart * itemSize, (section.vertexStart + section.vertexCount) * itemSize),
      itemSize,
    );
  geometry.setAttribute("position", view(shared.positions, 3));
  geometry.setAttribute("normal", view(shared.normals, 3));
  geometry.setAttribute("uv", view(shared.uvs, 2));
  geometry.setAttribute("uv2", view(shared.uvs2, 2));
  geometry.setAttribute("skinIndex", view(shared.skinIndices, 4));
  geometry.setAttribute("skinWeight", view(shared.skinWeights, 4));

  const rebased = indices
    .slice(section.indexStart, section.indexStart + section.indexCount)
    .map((index) => index - section.vertexStart);
  geometry.setIndex(new BufferAttribute(
    section.indexCount > 65535 ? new Uint32Array(rebased) : new Uint16Array(rebased),
    1,
  ));
  return geometry;
}

export function createNativeM2Actor(options: NativeM2ActorOptions): NativeM2Actor {
  const { model, skin, label } = options;

  // Shared skin-wide vertex arrays; each section views into them.
  const lookup = skin.vertexLookup;
  const shared = {
    positions: new Float32Array(lookup.length * 3),
    normals: new Float32Array(lookup.length * 3),
    uvs: new Float32Array(lookup.length * 2),
    uvs2: new Float32Array(lookup.length * 2),
    skinIndices: new Float32Array(lookup.length * 4),
    skinWeights: new Float32Array(lookup.length * 4),
  };
  for (let i = 0; i < lookup.length; i += 1) {
    const vertex = model.vertices[lookup[i]];
    shared.positions.set(vertex.position, i * 3);
    shared.normals.set(vertex.normal, i * 3);
    const [uv1x, uv1y] = vertex.uvs[0] ?? [0, 0];
    shared.uvs.set([uv1x, uv1y], i * 2);
    const [uv2x, uv2y] = vertex.uvs[1] ?? [0, 0];
    shared.uvs2.set([uv2x, uv2y], i * 2);
    shared.skinIndices.set(vertex.boneIndices, i * 4);
    const weights = vertex.boneWeights;
    const total = weights[0] + weights[1] + weights[2] + weights[3];
    shared.skinWeights.set(total > 0
      ? [weights[0] / total, weights[1] / total, weights[2] / total, weights[3] / total]
      : [0, 0, 0, 0], i * 4);
  }

  const geometries = new Map<number, BufferGeometry>();
  for (const section of skin.sections) {
    geometries.set(section.index, sectionGeometry(section, shared, skin.indices));
  }

  // Bone matrices as one RGBA32F row per bone (four texels = mat4 columns).
  const boneCount = Math.max(1, model.bones.length);
  const boneData = new Float32Array(boneCount * 16);
  for (let bone = 0; bone < boneCount; bone += 1) {
    const offset = bone * 16;
    boneData[offset] = 1;
    boneData[offset + 5] = 1;
    boneData[offset + 10] = 1;
    boneData[offset + 15] = 1;
  }
  const boneTexture = new DataTexture(boneData, 4, boneCount, RGBAFormat, FloatType);
  boneTexture.needsUpdate = true;
  let pose: number[][] = Array.from({ length: boneCount }, (_value, bone) =>
    Array.from(boneData.subarray(bone * 16, bone * 16 + 16)));

  // Neutral mid-grey stand-in for unbound slots: customization textures that
  // are not prepared yet stay visible instead of rendering black or dropping.
  const fallbackTexture = new DataTexture(new Uint8Array([NEUTRAL_FILL, NEUTRAL_FILL, NEUTRAL_FILL, 255]), 1, 1);
  fallbackTexture.needsUpdate = true;

  const pendingTypes = new Set<number>();
  const resolveSlotTexture = (slotIndex: number): Texture => {
    const texture = model.textures[slotIndex];
    if (!texture) return fallbackTexture;
    if (texture.type === 0) {
      const provided = options.textures.get(slotIndex);
      if (provided) {
        provided.wrapS = texture.flags & 0x1 ? RepeatWrapping : ClampToEdgeWrapping;
        provided.wrapT = texture.flags & 0x2 ? RepeatWrapping : ClampToEdgeWrapping;
        return provided;
      }
      return fallbackTexture;
    }
    const replacement = options.replaceableTextures?.get(texture.type);
    if (replacement) return replacement;
    pendingTypes.add(texture.type);
    return fallbackTexture;
  };

  const statusLines: string[] = [];
  const root = new Group();
  root.name = `${label}-m2-actor`;

  const order = skin.batches
    .map((batch, index) => ({ batch, index }))
    .sort((a, b) =>
      a.batch.priorityPlane - b.batch.priorityPlane
      || a.batch.materialLayer - b.batch.materialLayer
      || (model.materials[a.batch.materialIndex]?.blendMode ?? 0) - (model.materials[b.batch.materialIndex]?.blendMode ?? 0)
      || a.index - b.index);
  const renderOrder = new Map<number, number>();
  order.forEach((entry, rank) => renderOrder.set(entry.index, rank));

  const batches: NativeM2Batch[] = [];
  const unsupported: string[] = [];
  for (let index = 0; index < skin.batches.length; index += 1) {
    const batch = skin.batches[index];
    const section = skin.sections[batch.sectionIndex];
    if (!section) continue;
    const selection = selectM2Shaders(batch.shaderId, batch.textureCount);
    if (selection.unsupportedVertexShader !== null) unsupported.push(`VS ${selection.unsupportedVertexShader}`);
    if (selection.unsupportedPixelShader !== null) unsupported.push(`PS ${selection.unsupportedPixelShader}`);

    const material = model.materials[batch.materialIndex] ?? { flags: 0, blendMode: 0 };
    const renderFlags = m2RenderFlags(material.flags);
    const blend = m2BlendParams(material.blendMode);

    const units: Texture[] = [];
    for (let unit = 0; unit < MAX_TEXTURE_UNITS; unit += 1) {
      const slotIndex = unit < batch.textureCount ? model.textureLookup[batch.textureComboIndex + unit] : undefined;
      units.push(slotIndex === undefined ? fallbackTexture : resolveSlotTexture(slotIndex));
    }

    const shaderMaterial = new ShaderMaterial({
      vertexShader: M2_VERTEX_SHADER_SOURCE,
      fragmentShader: M2_FRAGMENT_SHADER_SOURCE,
      uniforms: {
        u_bone_texture: { value: boneTexture },
        u_bone_count: { value: boneCount },
        u_tex_matrix1: { value: new Matrix4() },
        u_tex_matrix2: { value: new Matrix4() },
        u_vertex_shader: { value: selection.vertexShader },
        u_pixel_shader: { value: selection.pixelShader },
        u_texture1: { value: units[0] },
        u_texture2: { value: units[1] },
        u_texture3: { value: units[2] },
        u_texture4: { value: units[3] },
        u_mesh_color: { value: new Vector4(1, 1, 1, 1) },
        u_tex_sample_alpha: { value: new Vector3(1, 1, 1) },
        u_alpha_test: { value: M2_ALPHA_KEY },
        u_blend_mode: { value: material.blendMode },
        u_apply_lighting: { value: renderFlags.unlit ? 0 : 1 },
        u_unsupported: {
          value: selection.unsupportedVertexShader !== null || selection.unsupportedPixelShader !== null ? 1 : 0,
        },
        u_ambient_sky: { value: new Vector3() },
        u_ambient_horizon: { value: new Vector3() },
        u_ambient_ground: { value: new Vector3() },
        u_sun_color: { value: new Vector3() },
        u_sun_direction: { value: new Vector3(0, 1, 0) },
        u_local_light: { value: new Vector3() },
        u_unlit_add: { value: new Vector3() },
        u_fog_color: { value: new Vector3().fromArray(options.fog?.color ?? [0, 0, 0]) },
        u_fog_range: { value: new Vector2(options.fog?.startPreview ?? 100000, options.fog?.endPreview ?? 100001) },
        u_unfogged: { value: renderFlags.unfogged ? 1 : 0 },
      },
      side: renderFlags.twoSided ? DoubleSide : FrontSide,
      depthTest: renderFlags.depthTest,
      depthWrite: renderFlags.depthWrite,
      transparent: material.blendMode !== 0 && material.blendMode !== 1,
      blending: blend.blending,
      blendSrc: blend.blendSrc,
      blendDst: blend.blendDst,
      blendSrcAlpha: blend.blendSrcAlpha,
      blendDstAlpha: blend.blendDstAlpha,
    });

    const mesh = new Mesh(geometries.get(section.index)!, shaderMaterial);
    mesh.name = `${label}-batch-${batch.index}`;
    mesh.frustumCulled = false;
    mesh.visible = options.geosetVisibility?.get(section.meshPartId) ?? isGeosetVisibleByDefault(section.meshPartId);
    mesh.renderOrder = renderOrder.get(index) ?? index;
    root.add(mesh);
    batches.push({ batch, section, mesh, material: shaderMaterial });
  }

  const pendingTextureTypes = Array.from(pendingTypes).sort((a, b) => a - b);
  if (pendingTextureTypes.length > 0) {
    statusLines.push(`${label} customization textures (types ${pendingTextureTypes.join(", ")}) pending`);
  }
  if (unsupported.length > 0) {
    statusLines.push(`${label} renders ${unsupported.join(", ")} with the unsupported fallback tint`);
  }

  const setLightPreset = (preset: M2LightPreset) => {
    // The shader lights world-space (three, Y-up) normals; convert the
    // recorded native sun direction once per preset.
    const sun = nativeToThreePoint(preset.sunDirectionNative);
    for (const { material } of batches) {
      (material.uniforms.u_ambient_sky.value as Vector3).fromArray(preset.ambientSky);
      (material.uniforms.u_ambient_horizon.value as Vector3).fromArray(preset.ambientHorizon);
      (material.uniforms.u_ambient_ground.value as Vector3).fromArray(preset.ambientGround);
      (material.uniforms.u_sun_color.value as Vector3).fromArray(preset.sunColor);
      (material.uniforms.u_sun_direction.value as Vector3).fromArray(sun);
      (material.uniforms.u_local_light.value as Vector3).fromArray(preset.localLight);
      (material.uniforms.u_unlit_add.value as Vector3).fromArray(preset.unlitAdd);
    }
  };
  setLightPreset(options.lightPreset ?? M2_PREVIEW_LIGHT_PRESET);

  return {
    model,
    skin,
    label,
    root,
    batches,
    pendingTextureTypes,
    statusLines,
    setPose(matrices: number[][]) {
      const count = Math.min(matrices.length, boneCount);
      for (let bone = 0; bone < count; bone += 1) {
        boneData.set(matrices[bone].slice(0, 16), bone * 16);
      }
      boneTexture.needsUpdate = true;
      pose = matrices;
    },
    updateAnimatedTracks(resolution: SequenceResolution, timeMs: number) {
      const transformCache = new Map<number, number[]>();
      const transformMatrix = (transformIndex: number): number[] => {
        let matrix = transformCache.get(transformIndex);
        if (!matrix) {
          matrix = sampleTextureTransformMatrix(model, resolution, transformIndex, timeMs);
          transformCache.set(transformIndex, matrix);
        }
        return matrix;
      };

      for (const { batch, material } of batches) {
        for (let unit = 0; unit < 2; unit += 1) {
          const lookupValue = model.textureTransformLookup[batch.textureTransformComboIndex + unit];
          const transformIndex = lookupValue === undefined || lookupValue === 65535 ? -1 : lookupValue;
          const target = unit === 0 ? material.uniforms.u_tex_matrix1 : material.uniforms.u_tex_matrix2;
          (target.value as Matrix4).fromArray(transformMatrix(transformIndex));
        }

        const color = sampleM2Color(model, resolution, batch.colorIndex, timeMs);
        const meshColor = material.uniforms.u_mesh_color.value as Vector4;
        if (color) meshColor.set(color.rgb[0], color.rgb[1], color.rgb[2], color.alpha);
        else meshColor.set(1, 1, 1, 1);

        const weights = material.uniforms.u_tex_sample_alpha.value as Vector3;
        for (let unit = 0; unit < 3; unit += 1) {
          const weightIndex = unit < batch.textureCount
            ? model.textureWeightLookup[batch.textureWeightComboIndex + unit] : undefined;
          const value = weightIndex !== undefined && weightIndex < model.textureWeights.length
            ? sampleM2TextureWeight(model, resolution, weightIndex, timeMs) : 1;
          if (unit === 0) weights.x = value;
          else if (unit === 1) weights.y = value;
          else weights.z = value;
        }
        if (batch.textureCount > 0 && (batch.flags & 0x40) === 0) meshColor.w *= weights.x;
        material.visible = meshColor.w >= 0.0001;
      }
    },
    setLightPreset,
    sampleAttachment(attachmentId: number) {
      return attachmentMatrix(model, pose, attachmentId);
    },
    dispose() {
      for (const { mesh, material } of batches) {
        mesh.geometry.dispose();
        material.dispose();
      }
      boneTexture.dispose();
      fallbackTexture.dispose();
    },
  };
}
