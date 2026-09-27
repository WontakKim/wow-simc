import {
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  ClampToEdgeWrapping,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  FrontSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Matrix4,
  Mesh,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  NoColorSpace,
  Quaternion,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three";
import { nativeToThreeMatrix, nativeToThreePoint as nativeToThree } from "./m2/coordinates";
import { decodeNativeBlp } from "./nativeBlp";
import type { NativeEffectAsset } from "./nativeEffectAssets";
import { parseNativeM2, parseNativeSkin, type NativeM2Model, type NativeParticleEmitter, type NativeRibbonEmitter, type NativeSkinProfile, type Vector3Tuple } from "./nativeM2";
import { m2BlendParams, m2ParticleAlphaThreshold, m2RenderFlags, selectParticlePixelShader } from "./nativeM2Blend";
import { sampleNativeEmitter, sampleNativeRibbonEdges, sampleNativeSkinnedNormal, sampleNativeSkinnedVertex, sampleNativeTrack, type NativeMatrix, type NativeParticleSample } from "./nativeParticles";

const FOG_FRAGMENT = `
  uniform vec3 uFogColor;
  uniform vec2 uFogRange;
  uniform int uFogBlendMode;
  uniform int uUnfogged;
  varying float vFogDistance;
  vec3 applyEffectFog(vec3 color, float alpha) {
    if (uUnfogged == 1) return color;
    float amount = clamp((vFogDistance - uFogRange.x) / (uFogRange.y - uFogRange.x), 0.0, 1.0);
    vec3 neutral = (uFogBlendMode == 3 || uFogBlendMode == 4) ? vec3(0.0)
      : uFogBlendMode == 5 ? vec3(1.0)
      : uFogBlendMode == 6 ? vec3(0.5)
      : uFogBlendMode == 7 ? uFogColor * alpha : uFogColor;
    return mix(color, neutral, amount);
  }
`;

const ASSET_ROOT = "/model/native-effects";
const SETUP_COMMAND = "node script/prepare-native-effects.mjs";

export interface NativeParticleRenderInstance {
  timeSeconds: number;
  emissionEndSeconds: number;
  modelScale: number;
  sourceTransformAtTime: (timeSeconds: number) => NativeMatrix;
  occurrenceSeed?: string;
}

interface RibbonBatch {
  ribbon: NativeRibbonEmitter;
  geometry: BufferGeometry;
  material: ShaderMaterial;
  mesh: Mesh;
  capacity: number;
}

interface EmitterBatch {
  emitter: NativeParticleEmitter;
  geometry: InstancedBufferGeometry;
  material: ShaderMaterial;
  offsets: InstancedBufferAttribute;
  sizes: InstancedBufferAttribute;
  colors: InstancedBufferAttribute;
  rotations: InstancedBufferAttribute;
  uvRects: InstancedBufferAttribute;
  velocities: InstancedBufferAttribute;
  alphaCutoffs: InstancedBufferAttribute;
  uvScrolls1: InstancedBufferAttribute;
  uvScrolls2: InstancedBufferAttribute;
  ages: InstancedBufferAttribute;
  isTail: boolean;
  capacity: number;
}

function maximumTrackValue(track: { sequences: Array<{ values: number[] }> }) {
  return Math.max(0, ...track.sequences.flatMap((sequence) => sequence.values));
}

function emitterCapacity(emitter: NativeParticleEmitter) {
  const maximumRate = maximumTrackValue(emitter.emissionRate) + Math.abs(emitter.emissionRateVariation);
  const maximumLifespan = maximumTrackValue(emitter.lifespan) + Math.abs(emitter.lifespanVariation);
  const capacity = Math.max(8, Math.ceil(maximumRate * (maximumLifespan + 0.1)) + 8);
  if (!Number.isSafeInteger(capacity)) throw new Error(`Emitter ${emitter.index}: authored particle capacity is not a safe integer.`);
  return capacity;
}

function createTexture(decoded: ReturnType<typeof decodeNativeBlp>) {
  const texture = new DataTexture(decoded.pixels, decoded.width, decoded.height, RGBAFormat, UnsignedByteType);
  // Color-domain policy: BLP bytes are display-domain; binding without an
  // sRGB internal format keeps the authored values on the canvas without a
  // second encode (same policy as the M2 actor loader).
  texture.colorSpace = NoColorSpace;
  texture.flipY = true;
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = ClampToEdgeWrapping;
  texture.wrapT = ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

function createEmitterBatch(
  emitter: NativeParticleEmitter,
  textures: DataTexture[],
  pixelShader: 0 | 1 | 2 | 3,
  maximumInstanceCount: number,
  isTail = false,
): EmitterBatch {
  const capacity = emitterCapacity(emitter) * maximumInstanceCount;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    -1, -1, 0,
    1, -1, 0,
    1, 1, 0,
    -1, 1, 0,
  ]), 3));
  geometry.setAttribute("uv", new BufferAttribute(new Float32Array([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ]), 2));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);

  const offsets = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
  const sizes = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
  const colors = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
  const rotations = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const uvRects = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(DynamicDrawUsage);
  const velocities = new InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(DynamicDrawUsage);
  const alphaCutoffs = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  const uvScrolls1 = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
  const uvScrolls2 = new InstancedBufferAttribute(new Float32Array(capacity * 2), 2).setUsage(DynamicDrawUsage);
  const ages = new InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(DynamicDrawUsage);
  geometry.setAttribute("instanceOffset", offsets);
  geometry.setAttribute("instanceSize", sizes);
  geometry.setAttribute("instanceColor", colors);
  geometry.setAttribute("instanceRotation", rotations);
  geometry.setAttribute("instanceUvRect", uvRects);
  geometry.setAttribute("instanceVelocity", velocities);
  geometry.setAttribute("instanceAlphaCutoff", alphaCutoffs);
  geometry.setAttribute("instanceUvScroll1", uvScrolls1);
  geometry.setAttribute("instanceUvScroll2", uvScrolls2);
  geometry.setAttribute("instanceAge", ages);
  geometry.instanceCount = 0;

  const velocityOriented = (emitter.flags & 0x4) !== 0;
  // PS1 (2ColorTex_3AlphaTex) and PS2 (3ColorTex_3AlphaTex) sample all three
  // authored textures; the flipbook rect keeps applying to the primary UV only.
  const usesMultiTexture = pixelShader > 0;
  const combiner = pixelShader === 2 || pixelShader === 3
    ? "vec4 combined = tex1 * tex2 * tex3 * particleColor;"
    : pixelShader === 1
      ? `vec4 combined = vec4(tex1.rgb * tex2.rgb * particleColor.rgb,
        tex1.a * tex2.a * tex3.a * particleColor.a);`
      : "vec4 combined = tex1 * particleColor;";
  const blend = m2BlendParams(emitter.blendingType);
  const material = new ShaderMaterial({
    uniforms: {
      map: { value: textures[emitter.textureIndices[0]] },
      ...(usesMultiTexture ? {
        map2: { value: textures[emitter.textureIndices[1]] },
        map3: { value: textures[emitter.textureIndices[2]] },
      } : {}),
      uPixelShader: { value: pixelShader },
      uAlphaTest: { value: m2ParticleAlphaThreshold(emitter.blendingType) },
      uColorMult: { value: emitter.exp2?.colorMultiplier ?? 1 },
      uAlphaMult: { value: emitter.exp2?.alphaMultiplier ?? 1 },
      uFogColor: { value: new Vector3() },
      uFogRange: { value: new Vector2(100000, 100001) },
      uFogBlendMode: { value: emitter.blendingType },
      uUnfogged: { value: 0 },
      ...(usesMultiTexture ? {
        uMultiTexScale1: { value: emitter.multiTextureScale[0] },
        uMultiTexScale2: { value: emitter.multiTextureScale[1] },
      } : {}),
    },
    vertexShader: `
      attribute vec3 instanceOffset;
      attribute vec2 instanceSize;
      attribute vec4 instanceColor;
      attribute float instanceRotation;
      attribute vec4 instanceUvRect;
      attribute vec3 instanceVelocity;
      attribute float instanceAlphaCutoff;
      attribute vec2 instanceUvScroll1;
      attribute vec2 instanceUvScroll2;
      attribute float instanceAge;
      uniform float uMultiTexScale1;
      uniform float uMultiTexScale2;
      varying float particleAlphaCutoff;
      varying float vFogDistance;
      varying vec2 particleUv;
      ${usesMultiTexture ? "varying vec2 particleUv2;\n      varying vec2 particleUv3;" : ""}
      varying vec4 particleColor;
      void main() {
        vec2 viewScale = vec2(
          length(modelViewMatrix[0].xyz),
          length(modelViewMatrix[1].xyz)
        );
        vec2 local = position.xy * instanceSize * viewScale;
        float angle = instanceRotation;
        ${velocityOriented ? `
          vec3 viewVelocity = (modelViewMatrix * vec4(instanceVelocity, 0.0)).xyz;
          if (length(viewVelocity.xy) > 0.00001) angle += atan(viewVelocity.y, viewVelocity.x) - 1.57079632679;
        ` : ""}
        float cosine = cos(angle);
        float sine = sin(angle);
        vec2 rotated = vec2(local.x * cosine - local.y * sine, local.x * sine + local.y * cosine);
        vec4 center = modelViewMatrix * vec4(instanceOffset, 1.0);
        vFogDistance = length(center.xyz);
        ${isTail ? `
          vec3 viewTrail = -(modelViewMatrix * vec4(instanceVelocity, 0.0)).xyz
            * ${(emitter.flags & 0x400) !== 0 ? `min(instanceAge, ${emitter.tailLength.toFixed(8)})` : emitter.tailLength.toFixed(8)};
          float screenLength = length(viewTrail.xy);
          vec3 halfTrail = screenLength > 0.01 ? viewTrail * 0.5 : vec3(instanceSize.x * 0.05, 0.0, 0.0);
          vec3 halfWidth = screenLength > 0.01
            ? vec3(-viewTrail.y, viewTrail.x, 0.0) * (instanceSize.y * viewScale.y / screenLength)
            : vec3(0.0, instanceSize.y * 0.05, 0.0);
          gl_Position = projectionMatrix * (center + vec4(halfTrail + position.x * halfTrail + position.y * halfWidth, 0.0));
        ` : "gl_Position = projectionMatrix * (center + vec4(rotated, 0.0, 0.0));"}
        particleUv = instanceUvRect.xy + uv * instanceUvRect.zw;
        ${usesMultiTexture ? "particleUv2 = uv * uMultiTexScale1 + instanceUvScroll1;\n        particleUv3 = uv * uMultiTexScale2 + instanceUvScroll2;" : ""}
        particleColor = instanceColor;
        particleAlphaCutoff = instanceAlphaCutoff;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      ${usesMultiTexture ? "uniform sampler2D map2;\n      uniform sampler2D map3;" : ""}
      uniform float uAlphaTest;
      uniform float uColorMult;
      uniform float uAlphaMult;
      varying vec2 particleUv;
      ${usesMultiTexture ? "varying vec2 particleUv2;\n      varying vec2 particleUv3;" : ""}
      varying vec4 particleColor;
      varying float particleAlphaCutoff;
      ${FOG_FRAGMENT}
      void main() {
        vec4 tex1 = texture2D(map, particleUv);
        ${usesMultiTexture ? "vec4 tex2 = texture2D(map2, particleUv2);\n        vec4 tex3 = texture2D(map3, particleUv3);" : ""}
        if (tex1.a < uAlphaTest) discard;
        ${combiner}
        if (combined.a < uAlphaTest) discard;
        if (combined.a < particleAlphaCutoff) discard;
        float alpha = combined.a * uAlphaMult;
        gl_FragColor = vec4(applyEffectFog(combined.rgb * uColorMult, alpha), alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    // The original pipeline only writes depth for the opaque and alpha-key modes.
    depthWrite: emitter.blendingType <= 1,
    blending: blend.blending,
    blendSrc: blend.blendSrc,
    blendDst: blend.blendDst,
    blendSrcAlpha: blend.blendSrcAlpha,
    blendDstAlpha: blend.blendDstAlpha,
    fog: false,
  });

  return { emitter, geometry, material, offsets, sizes, colors, rotations, uvRects, velocities, alphaCutoffs, uvScrolls1, uvScrolls2, ages, isTail, capacity };
}

function squaredDistance(sample: NativeParticleSample, cameraPosition: Vector3) {
  const position = nativeToThree(sample.position);
  return (position[0] - cameraPosition.x) ** 2
    + (position[1] - cameraPosition.y) ** 2
    + (position[2] - cameraPosition.z) ** 2;
}

export class NativeParticleEffect {
  readonly group = new Group();
  readonly model: NativeM2Model;
  readonly renderedEmitterCount: number;
  readonly unsupportedEmitters: string[];
  private readonly textures: DataTexture[];
  private readonly batches: EmitterBatch[];
  readonly ribbonLimitations: string[];
  private readonly ribbonBatches: RibbonBatch[];
  readonly meshTriangleCount: number;
  readonly animationSequenceIndex: number;
  readonly unsupportedMeshBatches: string[];
  private readonly meshBatches: Array<{ geometry: BufferGeometry; material: ShaderMaterial; mesh: Mesh; textureWeightIndex: number; colorIndex: number; instanceIndex: number; secondaryTransformIndex: number }>;
  private readonly skin: NativeSkinProfile | undefined;
  private readonly maximumInstanceCount: number;

  constructor(
    model: NativeM2Model,
    decodedTextures: ReturnType<typeof decodeNativeBlp>[],
    maximumInstanceCount = 1,
    skin?: NativeSkinProfile,
  ) {
    if (!Number.isInteger(maximumInstanceCount) || maximumInstanceCount < 1) {
      throw new Error(`FileDataID ${model.fileDataId}: native instance capacity must be a positive integer.`);
    }
    this.model = model;
    this.animationSequenceIndex = skin ? model.sequenceIds.findIndex((_, sequenceIndex) =>
      skin.batches.some((batch) => batch.colorIndex < 0
        || model.colors[batch.colorIndex]?.alpha.sequences[sequenceIndex]?.values.some((alpha) => alpha > 0))) : 0;
    if (this.animationSequenceIndex < 0) {
      throw new Error(`FileDataID ${model.fileDataId}: no authored mesh animation sequence has visible alpha.`);
    }
    this.skin = skin;
    if (model.vertices.length > 0 && !skin) throw new Error(`FileDataID ${model.fileDataId}: authored mesh requires a pinned SKIN profile.`);
    if (model.vertices.length === 0 && skin) throw new Error(`FileDataID ${model.fileDataId}: SKIN supplied without authored vertices.`);
    // PS3 has the PS2 color equation; only its TXAC UV behavior remains unknown.
    // PS4 refraction remains omitted.
    this.unsupportedEmitters = [];
    const renderedPixelShaders: Array<0 | 1 | 2 | 3> = [];
    const renderedEmitters: NativeParticleEmitter[] = [];
    for (const emitter of model.emitters) {
      const control = model.particleTextureControls[emitter.index];
      const textureControlValue = control ? control[0] | (control[1] << 8) : 0;
      const pixelShader = selectParticlePixelShader(emitter.flags, textureControlValue);
      if (pixelShader === 4) {
        this.unsupportedEmitters.push(`emitter ${emitter.index}: refraction unsupported`);
        continue;
      }
      renderedEmitters.push(emitter);
      renderedPixelShaders.push(pixelShader);
    }
    if (renderedEmitters.length === 0 && model.ribbons.length === 0 && !skin) {
      throw new Error(`FileDataID ${model.fileDataId}: no supported authored emitters; ${this.unsupportedEmitters.join(", ")}.`);
    }
    this.renderedEmitterCount = renderedEmitters.length;
    this.maximumInstanceCount = maximumInstanceCount;
    this.textures = decodedTextures.map(createTexture);
    this.batches = renderedEmitters.flatMap((emitter, batchIndex) => {
      const textureCount = renderedPixelShaders[batchIndex] > 0 ? emitter.textureIndices.length : 1;
      for (const textureIndex of emitter.textureIndices.slice(0, textureCount)) {
        if (!this.textures[textureIndex]) {
          throw new Error(`FileDataID ${model.fileDataId}: emitter ${emitter.index} texture is unavailable.`);
        }
      }
      return [
        ...((emitter.flags & 0x20000) !== 0 ? [createEmitterBatch(emitter, this.textures, renderedPixelShaders[batchIndex], maximumInstanceCount)] : []),
        ...((emitter.flags & 0x40000) !== 0 ? [createEmitterBatch(emitter, this.textures, renderedPixelShaders[batchIndex], maximumInstanceCount, true)] : []),
      ];
    });

    for (const batch of this.batches) {
      const mesh = new Mesh(batch.geometry, batch.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 100 + batch.emitter.priorityPlane;
      this.group.add(mesh);
    }
    this.ribbonLimitations = model.ribbons.flatMap((ribbon) => [
      ...(ribbon.textureTransformLookupIndex !== 0 ? [`ribbon ${ribbon.index}: texture transform lookup ${ribbon.textureTransformLookupIndex} not applied`] : []),
      ...(ribbon.colorIndex !== 0 ? [`ribbon ${ribbon.index}: color index ${ribbon.colorIndex} not applied`] : []),
      ...(ribbon.materialIndices.some((index) => (model.materials[index].flags & 0x140) !== 0) ? [`ribbon ${ribbon.index}: material flags 0x40 and 0x100 have unverified shadow/render semantics`] : []),
    ]);
    this.ribbonBatches = model.ribbons.flatMap((ribbon) => ribbon.materialIndices.map((materialIndex, passIndex) => {
      const materialSource = model.materials[materialIndex];
      if ((materialSource.flags & ~0x15d) !== 0) {
        throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} material flags 0x${materialSource.flags.toString(16)} contain unsupported bits.`);
      }
      const ribbonBlend = m2BlendParams(materialSource.blendMode);
      const ribbonFlags = m2RenderFlags(materialSource.flags);
      if (!(ribbon.edgesPerSecond > 0) || !(ribbon.edgeLifetime > 0) || !Number.isFinite(ribbon.edgesPerSecond * ribbon.edgeLifetime)) {
        throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} invalid authored edge rate or lifetime.`);
      }
      const capacity = (Math.ceil(Math.ceil(ribbon.edgesPerSecond) * Math.max(ribbon.edgeLifetime, 0.25)) + 2) * maximumInstanceCount;
      if (!Number.isSafeInteger(capacity) || capacity * 2 > 65535) {
        throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} requires more than the 16-bit index resource bound.`);
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute("uv", new BufferAttribute(new Float32Array(capacity * 4), 2).setUsage(DynamicDrawUsage));
      geometry.setAttribute("ribbonColor", new BufferAttribute(new Float32Array(capacity * 8), 4).setUsage(DynamicDrawUsage));
      const indices = new Uint16Array((capacity - maximumInstanceCount) * 6);
      geometry.setIndex(new BufferAttribute(indices, 1));
      geometry.setDrawRange(0, 0);
      const texture = this.textures[ribbon.textureIndices[passIndex]];
      if (!texture) throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} pass ${passIndex} texture is unavailable.`);
      const material = new ShaderMaterial({
        uniforms: {
          map: { value: texture },
          uAlphaTest: { value: m2ParticleAlphaThreshold(materialSource.blendMode) },
          uFogColor: { value: new Vector3() },
          uFogRange: { value: new Vector2(100000, 100001) },
          uFogBlendMode: { value: materialSource.blendMode },
          uUnfogged: { value: ribbonFlags.unfogged ? 1 : 0 },
        },
        vertexShader: `attribute vec4 ribbonColor; varying vec4 vRibbonColor; varying vec2 vRibbonUv; varying float vFogDistance;
          void main() { vRibbonColor = ribbonColor; vRibbonUv = uv;
            vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
            vFogDistance = length(viewPosition.xyz);
            gl_Position = projectionMatrix * viewPosition; }`,
        fragmentShader: `uniform sampler2D map; uniform float uAlphaTest; varying vec4 vRibbonColor; varying vec2 vRibbonUv;
          ${FOG_FRAGMENT}
          void main() { gl_FragColor = texture2D(map, vRibbonUv) * vRibbonColor;
            if (gl_FragColor.a < uAlphaTest) discard;
            gl_FragColor.rgb = applyEffectFog(gl_FragColor.rgb, gl_FragColor.a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        blending: ribbonBlend.blending,
        blendSrc: ribbonBlend.blendSrc,
        blendDst: ribbonBlend.blendDst,
        blendSrcAlpha: ribbonBlend.blendSrcAlpha,
        blendDstAlpha: ribbonBlend.blendDstAlpha,
        depthWrite: ribbonFlags.depthWrite,
        depthTest: ribbonFlags.depthTest,
        side: ribbonFlags.twoSided ? DoubleSide : FrontSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 100 + ribbon.priorityPlane;
      this.group.add(mesh);
      return { ribbon, geometry, material, mesh, capacity };
    }));
    this.meshBatches = [];
    this.unsupportedMeshBatches = [];
    this.meshTriangleCount = skin ? skin.batches.reduce((total, batch) => total + skin.sections[batch.sectionIndex].indexCount / 3, 0) : 0;
    if (skin) {
      for (const [index, batch] of skin.batches.entries()) {
        const section = skin.sections[batch.sectionIndex];
        const material = model.materials[batch.materialIndex];
        if (!material || material.blendMode > 7 || (material.flags & ~0x11d5) !== 0
          || (material.flags & 0x15) !== 0x15 || (material.flags & 0x1000) === 0
          || (batch.shaderId !== 0x4014 && batch.shaderId !== 0x14) || batch.flags !== 0x80 || batch.textureCount !== 2) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} material, flags or shader cannot be rendered with the verified two-unit Mod2x path.`);
        }
        const textureIndices = Array.from({ length: batch.textureCount }, (_, unit) => model.textureLookup[batch.textureComboIndex + unit]);
        const transformIndices = Array.from({ length: batch.textureCount }, (_, unit) => model.textureTransformLookup[batch.textureTransformComboIndex + unit]);
        if (textureIndices.some((textureIndex) => textureIndex === undefined || !this.textures[textureIndex])
          || transformIndices.some((transformIndex) => transformIndex === undefined || transformIndex >= model.textureTransforms.length)) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} texture or transform lookup is outside the original data.`);
        }
        if (transformIndices.some((transformIndex) => transformIndex < -1)) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} has an invalid UV transform lookup.`);
        }
        if (model.textureCoordinates.length !== 0) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} texture coordinate lookup is not supported.`);
        }
        const textureWeightIndex = model.textureWeightLookup[batch.textureWeightComboIndex];
        if (textureWeightIndex === undefined || !model.textureWeights[textureWeightIndex]
          || (batch.colorIndex >= 0 && !model.colors[batch.colorIndex])) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} color or texture weight lookup is outside the original data.`);
        }
        for (let vertexIndex = section.vertexStart; vertexIndex < section.vertexStart + section.vertexCount; vertexIndex += 1) {
          const vertex = model.vertices[skin.vertexLookup[vertexIndex]];
          for (let slot = 0; slot < 4; slot += 1) {
            if (vertex.boneWeights[slot] && (vertex.boneIndices[slot] >= model.bones.length
              || vertex.boneIndices[slot] !== skin.boneRemap[vertexIndex][slot])) {
              throw new Error(`FileDataID ${model.fileDataId}: SKIN vertex ${vertexIndex} bone remap differs from its authored M2 bone index.`);
            }
          }
        }
        for (const textureIndex of textureIndices) {
          const textureFlags = model.textureFlags[textureIndex];
          if ((textureFlags & ~3) !== 0) throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} texture wrapping flags are unsupported.`);
          this.textures[textureIndex].wrapS = (textureFlags & 1) !== 0 ? RepeatWrapping : ClampToEdgeWrapping;
          this.textures[textureIndex].wrapT = (textureFlags & 2) !== 0 ? RepeatWrapping : ClampToEdgeWrapping;
        }
        const primaryTransform = model.textureTransforms[transformIndices[0]];
        const secondaryTransform = model.textureTransforms[transformIndices[1]];
        const hasRotation = (transform: typeof primaryTransform) => transform?.rotation.sequences.some((sequence) =>
          sequence.values.some(([x, y, z, w]) => x !== 0 || y !== 0 || z !== 0 || w !== 1));
        if (hasRotation(primaryTransform) || hasRotation(secondaryTransform) || (batch.shaderId === 0x4014 && transformIndices[0] !== -1)) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} UV rotation or primary UV transform is unsupported.`);
        }
        if (batch.shaderId === 0x14 && [primaryTransform, secondaryTransform].some((transform) => transform && (
          transform.translation.sequences.some((sequence) => sequence.values.some(([x, y]) => x !== 0 || y !== 0))
          || transform.scale.sequences.some((sequence) => sequence.values.some(([x, y]) => x !== 1 || y !== 1))))) {
          throw new Error(`FileDataID ${model.fileDataId}: mesh batch ${index} T1/T1 UV transform is not identity.`);
        }
        for (let instanceIndex = 0; instanceIndex < maximumInstanceCount; instanceIndex += 1) {
          const geometry = new BufferGeometry();
          geometry.setAttribute("position", new BufferAttribute(new Float32Array(skin.vertexLookup.length * 3), 3).setUsage(DynamicDrawUsage));
          geometry.setAttribute("normal", new BufferAttribute(new Float32Array(skin.vertexLookup.length * 3), 3).setUsage(DynamicDrawUsage));
          geometry.setAttribute("uv", new BufferAttribute(new Float32Array(skin.vertexLookup.flatMap((vertexIndex) => model.vertices[vertexIndex].uv[0])), 2));
          geometry.setIndex(skin.indices);
          geometry.setDrawRange(section.indexStart, section.indexCount);
          if (batch.shaderId === 0x4014) {
            geometry.setAttribute("secondaryUv", new BufferAttribute(new Float32Array(skin.vertexLookup.flatMap((vertexIndex) => model.vertices[vertexIndex].uv[1])), 2));
          }
          const meshBlend = m2BlendParams(material.blendMode);
          const meshFlags = m2RenderFlags(material.flags);
          const meshMaterial = new ShaderMaterial({
            uniforms: {
              primaryMap: { value: this.textures[textureIndices[0]] },
              secondaryMap: { value: this.textures[textureIndices[1]] },
              meshColor: { value: new Color(1, 1, 1) },
              meshOpacity: { value: 1 },
              secondaryUvScale: { value: new Vector2(1, 1) },
              secondaryUvTranslation: { value: new Vector2() },
              uFogColor: { value: new Vector3() },
              uFogRange: { value: new Vector2(100000, 100001) },
              uFogBlendMode: { value: material.blendMode },
              uUnfogged: { value: meshFlags.unfogged ? 1 : 0 },
            },
            vertexShader: `${batch.shaderId === 0x4014 ? "attribute vec2 secondaryUv;" : ""} uniform vec2 secondaryUvScale; uniform vec2 secondaryUvTranslation;
              varying vec2 primaryCoordinates; varying vec2 secondaryCoordinates; varying float vFogDistance;
              void main() {
                primaryCoordinates = uv;
                secondaryCoordinates = ${batch.shaderId === 0x4014 ? "secondaryUv * secondaryUvScale + secondaryUvTranslation" : "uv"};
                vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
                vFogDistance = length(viewPosition.xyz);
                gl_Position = projectionMatrix * viewPosition;
              }`,
            fragmentShader: `uniform sampler2D primaryMap; uniform sampler2D secondaryMap;
              uniform vec3 meshColor; uniform float meshOpacity;
              varying vec2 primaryCoordinates; varying vec2 secondaryCoordinates;
              ${FOG_FRAGMENT}
              void main() {
                vec4 primary = texture2D(primaryMap, primaryCoordinates);
                vec4 secondary = texture2D(secondaryMap, secondaryCoordinates);
                gl_FragColor = vec4(meshColor * primary.rgb * secondary.rgb * 2.0,
                  meshOpacity * primary.a * secondary.a * 2.0);
                if (gl_FragColor.a < ${m2ParticleAlphaThreshold(material.blendMode)}) discard;
                gl_FragColor.rgb = applyEffectFog(gl_FragColor.rgb, gl_FragColor.a);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
              }`,
            transparent: true,
            blending: meshBlend.blending,
            blendSrc: meshBlend.blendSrc,
            blendDst: meshBlend.blendDst,
            blendSrcAlpha: meshBlend.blendSrcAlpha,
            blendDstAlpha: meshBlend.blendDstAlpha,
            side: meshFlags.twoSided ? DoubleSide : FrontSide,
            depthTest: meshFlags.depthTest,
            depthWrite: meshFlags.depthWrite,
            fog: false,
          });
          const mesh = new Mesh(geometry, meshMaterial);
          mesh.visible = false;
          mesh.frustumCulled = false;
          mesh.renderOrder = 100 + batch.priorityPlane;
          this.group.add(mesh);
          this.meshBatches.push({ geometry, material: meshMaterial, mesh,
            textureWeightIndex, colorIndex: batch.colorIndex, instanceIndex,
            secondaryTransformIndex: batch.shaderId === 0x4014 ? transformIndices[1] : -1 });
        }
        const unknownMaterialFlags = [0x40, 0x80, 0x100, 0x1000]
          .filter((flag) => (material.flags & flag) !== 0)
          .map((flag) => `0x${flag.toString(16)}`).join(", ");
        this.unsupportedMeshBatches.push(`batch ${index}: material flags ${unknownMaterialFlags} and batch flag 0x80 have unverified shadow/render semantics`);
      }
    }
    this.group.name = `Native M2 FileDataID ${model.fileDataId}`;
    this.group.position.set(-0.15, 1.2, 0);
    this.group.scale.setScalar(0.38);
  }

  setFog(fog: { startPreview: number; endPreview: number; color: readonly [number, number, number] }) {
    for (const { material } of [...this.batches, ...this.ribbonBatches, ...this.meshBatches]) {
      (material.uniforms.uFogColor.value as Vector3).fromArray(fog.color);
      (material.uniforms.uFogRange.value as Vector2).set(fog.startPreview, fog.endPreview);
    }
  }

  private renderRibbons(instances: NativeParticleRenderInstance[]) {
    const duration = this.model.sequenceDurationsMs[this.animationSequenceIndex];
    for (const batch of this.ribbonBatches) {
      const { ribbon, geometry } = batch;
      const positions = geometry.getAttribute("position") as BufferAttribute;
      const uvs = geometry.getAttribute("uv") as BufferAttribute;
      const colors = geometry.getAttribute("ribbonColor") as BufferAttribute;
      const indices = geometry.index!;
      let edgeCount = 0;
      let triangleCount = 0;
      for (const instance of instances) {
        const edges = sampleNativeRibbonEdges(ribbon, this.model.bones[ribbon.boneIndex], duration, instance.timeSeconds,
          { ...instance, bones: this.model.bones, globalSequenceDurationsMs: this.model.globalSequenceDurationsMs,
            sequenceIndex: this.animationSequenceIndex });
        if (edgeCount + edges.length > batch.capacity) {
          throw new Error(`FileDataID ${this.model.fileDataId}: ribbon ${ribbon.index} exceeds its ${batch.capacity}-edge resource bound.`);
        }
        for (const [index, edge] of edges.entries()) {
          positions.setXYZ(edgeCount * 2, ...nativeToThree(edge.above));
          positions.setXYZ(edgeCount * 2 + 1, ...nativeToThree(edge.below));
          uvs.setXY(edgeCount * 2, edge.u, edge.v);
          uvs.setXY(edgeCount * 2 + 1, edge.u, edge.v + 1 / ribbon.rows);
          for (const side of [0, 1]) colors.setXYZW(edgeCount * 2 + side, ...edge.color, edge.alpha);
          if (index > 0) {
            const previous = (edgeCount - 1) * 2;
            const next = edgeCount * 2;
            for (const [offset, vertex] of [previous, previous + 1, next, previous + 1, next + 1, next].entries()) {
              indices.setX(triangleCount * 3 + offset, vertex);
            }
            triangleCount += 2;
          }
          edgeCount += 1;
        }
      }
      geometry.setDrawRange(0, triangleCount * 3);
      for (const attribute of [positions, uvs, colors, indices]) attribute.needsUpdate = true;
    }
  }

  private renderInstances(instances: NativeParticleRenderInstance[], camera: Camera) {
    if (instances.length > this.maximumInstanceCount) {
      throw new Error(
        `FileDataID ${this.model.fileDataId}: ${instances.length} simultaneous component instances exceed the ${this.maximumInstanceCount}-instance resource bound.`,
      );
    }

    this.renderRibbons(instances);
    this.group.updateWorldMatrix(true, false);
    const localCamera = this.group.worldToLocal(camera.getWorldPosition(new Vector3()));
    let totalParticleCount = 0;
    for (const batch of this.batches) {
      let particles = instances.flatMap((instance) => sampleNativeEmitter(
        batch.emitter,
        this.model.bones[batch.emitter.boneIndex],
        this.model.sequenceDurationsMs[this.animationSequenceIndex],
        instance.timeSeconds,
        { ...instance, bones: this.model.bones, globalSequenceDurationsMs: this.model.globalSequenceDurationsMs,
          sequenceIndex: this.animationSequenceIndex },
      ));
      if ((batch.emitter.flags & 0x2) !== 0) {
        particles = [...particles].sort((first, second) =>
          squaredDistance(second, localCamera) - squaredDistance(first, localCamera));
      }
      if (particles.length > batch.capacity) {
        throw new Error(`FileDataID ${this.model.fileDataId}: emitter ${batch.emitter.index} exceeds its ${batch.capacity}-particle resource bound.`);
      }
      particles.forEach((particle, index) => {
        const position = nativeToThree(particle.position);
        const velocity = nativeToThree(particle.velocity);
        batch.offsets.setXYZ(index, ...position);
        batch.sizes.setXY(index, particle.size[0], particle.size[1]);
        batch.colors.setXYZW(index, particle.color[0], particle.color[1], particle.color[2], particle.alpha);
        batch.rotations.setX(index, particle.rotation);
        const frame = batch.isTail ? particle.tailUvFrame : particle.uvFrame;
        const column = frame % batch.emitter.columns;
        const row = Math.floor(frame / batch.emitter.columns);
        const width = 1 / batch.emitter.columns;
        const height = 1 / batch.emitter.rows;
        batch.uvRects.setXYZW(index, column * width, 1 - (row + 1) * height, width, height);
        batch.velocities.setXYZ(index, ...velocity);
        batch.ages.setX(index, particle.age);
        batch.alphaCutoffs.setX(index, particle.alphaCutoff);
        batch.uvScrolls1.setXY(index, ...(particle.uvScrollOffsets?.[0] ?? [0, 0]));
        batch.uvScrolls2.setXY(index, ...(particle.uvScrollOffsets?.[1] ?? [0, 0]));
      });
      batch.geometry.instanceCount = particles.length;
      totalParticleCount += particles.length;
      batch.offsets.needsUpdate = true;
      batch.sizes.needsUpdate = true;
      batch.colors.needsUpdate = true;
      batch.rotations.needsUpdate = true;
      batch.uvRects.needsUpdate = true;
      batch.velocities.needsUpdate = true;
      batch.ages.needsUpdate = true;
      batch.alphaCutoffs.needsUpdate = true;
      batch.uvScrolls1.needsUpdate = true;
      batch.uvScrolls2.needsUpdate = true;
    }
    return totalParticleCount;
  }

  private renderMesh(instances: NativeParticleRenderInstance[]) {
    if (!this.skin) return;
    if (instances.length > this.maximumInstanceCount) {
      throw new Error(`FileDataID ${this.model.fileDataId}: ${instances.length} simultaneous mesh instances exceed the ${this.maximumInstanceCount}-instance LOD0 skinning bound.`);
    }
    for (const batch of this.meshBatches) {
      const instance = instances[batch.instanceIndex];
      batch.mesh.visible = Boolean(instance && instance.timeSeconds >= 0);
      if (!batch.mesh.visible || !instance) continue;
      const timeMs = instance.timeSeconds * 1000;
      const sequenceDurationMs = this.model.sequenceDurationsMs[this.animationSequenceIndex];
      const positions = batch.geometry.getAttribute("position") as BufferAttribute;
      const normals = batch.geometry.getAttribute("normal") as BufferAttribute;
      this.skin.vertexLookup.forEach((vertexIndex, index) => {
        const vertex = this.model.vertices[vertexIndex];
        positions.setXYZ(index, ...nativeToThree(sampleNativeSkinnedVertex(vertex, this.model.bones, timeMs,
          sequenceDurationMs, this.model.globalSequenceDurationsMs, this.animationSequenceIndex)));
        normals.setXYZ(index, ...nativeToThree(sampleNativeSkinnedNormal(vertex, this.model.bones, timeMs,
          sequenceDurationMs, this.model.globalSequenceDurationsMs, this.animationSequenceIndex)));
      });
      positions.needsUpdate = true;
      normals.needsUpdate = true;
      const transform = instance.sourceTransformAtTime(instance.timeSeconds);
      const source = nativeToThreeMatrix(transform);
      const orientation = new Quaternion();
      const authoredScale = new Vector3();
      new Matrix4().fromArray(source).decompose(batch.mesh.position, orientation, authoredScale);
      batch.mesh.quaternion.copy(orientation);
      batch.mesh.scale.copy(authoredScale.multiplyScalar(instance.modelScale));
      let opacity = 1;
      const color = new Color(1, 1, 1);
      if (batch.colorIndex >= 0) {
        const colorTrack = this.model.colors[batch.colorIndex];
        const sampledColor = sampleNativeTrack(colorTrack.color, timeMs, sequenceDurationMs,
          [1, 1, 1], this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
        color.setRGB(sampledColor[0], sampledColor[1], sampledColor[2]);
        opacity = sampleNativeTrack(colorTrack.alpha, timeMs, sequenceDurationMs,
          1, this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
      }
      opacity *= sampleNativeTrack(this.model.textureWeights[batch.textureWeightIndex], timeMs,
        sequenceDurationMs, 1, this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
      batch.material.uniforms.meshColor.value.copy(color);
      batch.material.uniforms.meshOpacity.value = opacity;
      if (batch.secondaryTransformIndex >= 0) {
        const transform = this.model.textureTransforms[batch.secondaryTransformIndex];
        const translation = sampleNativeTrack(transform.translation, timeMs, sequenceDurationMs,
          [0, 0, 0], this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
        const scale = sampleNativeTrack(transform.scale, timeMs, sequenceDurationMs,
          [1, 1, 1], this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
        batch.material.uniforms.secondaryUvTranslation.value.set(translation[0], translation[1]);
        batch.material.uniforms.secondaryUvScale.value.set(scale[0], scale[1]);
      }
    }
  }

  setTime(timeSeconds: number, camera: Camera) {
    const instances = [{ timeSeconds, emissionEndSeconds: Number.POSITIVE_INFINITY,
      modelScale: 1, sourceTransformAtTime: () => [
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
      ] }];
    this.renderMesh(instances);
    return this.renderInstances(instances, camera);
  }

  setReplayInstances(instances: NativeParticleRenderInstance[], camera: Camera) {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(1);
    this.renderMesh(instances);
    return this.renderInstances(instances, camera);
  }

  clearInstances() {
    for (const batch of this.batches) batch.geometry.instanceCount = 0;
    for (const batch of this.ribbonBatches) batch.geometry.setDrawRange(0, 0);
    for (const batch of this.meshBatches) batch.mesh.visible = false;
  }

  dispose() {
    for (const batch of this.batches) {
      batch.geometry.dispose();
      batch.material.dispose();
    }
    for (const batch of this.ribbonBatches) {
      batch.geometry.dispose();
      batch.material.dispose();
    }
    for (const batch of this.meshBatches) {
      batch.geometry.dispose();
      batch.material.dispose();
    }
    for (const texture of this.textures) texture.dispose();
    this.group.removeFromParent();
  }
}

async function sha256(source: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", source);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

async function fetchPinnedAsset(fileDataId: number, extension: "m2" | "blp" | "skin", expectedSha256: string) {
  const response = await fetch(`${ASSET_ROOT}/${fileDataId}.${extension}`);
  if (!response.ok) {
    throw new Error(`FileDataID ${fileDataId}: request failed with status ${response.status}. Run ${SETUP_COMMAND}.`);
  }
  const source = await response.arrayBuffer();
  const actualSha256 = await sha256(source);
  if (actualSha256 !== expectedSha256) {
    throw new Error(`FileDataID ${fileDataId}: SHA-256 mismatch (${actualSha256}); expected ${expectedSha256}. Run ${SETUP_COMMAND}.`);
  }
  return source;
}

export async function loadNativeParticleEffect(asset: NativeEffectAsset, maximumInstanceCount = 1) {
  try {
    const [modelSource, ...textureSources] = await Promise.all([
      fetchPinnedAsset(asset.fileDataId, "m2", asset.sha256),
      ...asset.textures.map((texture) => fetchPinnedAsset(texture.fileDataId, "blp", texture.sha256)),
    ]);
    const model = parseNativeM2(modelSource, asset.fileDataId);
    if (model.ribbons.length !== (asset.expectedRibbonCount ?? 0)) {
      throw new Error(`FileDataID ${asset.fileDataId}: expected ${asset.expectedRibbonCount ?? 0} authored ribbons, found ${model.ribbons.length}.`);
    }
    if (model.emitters.length !== asset.expectedEmitterCount) {
      throw new Error(`FileDataID ${asset.fileDataId}: expected ${asset.expectedEmitterCount} authored emitters, found ${model.emitters.length}.`);
    }
    const manifestTextureIds = asset.textures.map((texture) => texture.fileDataId);
    if (model.textureFileDataIds.some((fileDataId, index) => fileDataId !== manifestTextureIds[index])
      || model.textureFileDataIds.length !== manifestTextureIds.length) {
      throw new Error(`FileDataID ${asset.fileDataId}: parsed TXIDs do not match the pinned original texture manifest.`);
    }
    const decodedTextures = textureSources.map((source, index) =>
      decodeNativeBlp(source, asset.textures[index].fileDataId));
    const skinAsset = asset.skin;
    if (model.vertices.length > 0 && (!skinAsset || model.skinFileDataIds[0] !== skinAsset.fileDataId)) {
      throw new Error(`FileDataID ${asset.fileDataId}: no matching pinned LOD0 SKIN profile.`);
    }
    const skinSource = skinAsset ? await fetchPinnedAsset(skinAsset.fileDataId, "skin", skinAsset.sha256) : undefined;
    const skin = skinSource ? parseNativeSkin(skinSource, skinAsset!.fileDataId, model.vertices.length) : undefined;
    return new NativeParticleEffect(model, decodedTextures, maximumInstanceCount, skin);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "Unknown native asset failure.";
    throw new Error(`${reason} No substitute effect was rendered.`);
  }
}
