import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Camera,
  Color,
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  LinearFilter,
  Mesh,
  NormalBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  RGBAFormat,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
} from "three";
import { decodeNativeBlp } from "./nativeBlp";
import type { NativeEffectAsset } from "./nativeEffectAssets";
import { parseNativeM2, parseNativeSkin, type NativeM2Model, type NativeParticleEmitter, type NativeRibbonEmitter, type NativeSkinProfile, type Vector3Tuple } from "./nativeM2";
import { applyBonePoint, sampleNativeEmitter, sampleNativeSkinnedNormal, sampleNativeSkinnedVertex, sampleNativeTrack, type NativeParticleSample } from "./nativeParticles";

const ASSET_ROOT = "/model/native-effects";
const SETUP_COMMAND = "node script/prepare-native-effects.mjs";

export interface NativeParticleRenderInstance {
  timeSeconds: number;
  emissionEndSeconds: number;
  modelScale: number;
  sourceTranslationAtTime: (timeSeconds: number) => Vector3Tuple;
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
  capacity: number;
}

function nativeToThree(value: Vector3Tuple): Vector3Tuple {
  return [value[0], -value[2], value[1]];
}

function maximumTrackValue(track: { sequences: Array<{ values: number[] }> }) {
  return Math.max(0, ...track.sequences.flatMap((sequence) => sequence.values));
}

function emitterCapacity(emitter: NativeParticleEmitter) {
  const maximumRate = maximumTrackValue(emitter.emissionRate) + Math.abs(emitter.emissionRateVariation);
  const maximumLifespan = maximumTrackValue(emitter.lifespan) + Math.abs(emitter.lifespanVariation);
  return Math.max(8, Math.min(1024, Math.ceil(maximumRate * (maximumLifespan + 0.1)) + 8));
}

function createTexture(decoded: ReturnType<typeof decodeNativeBlp>) {
  const texture = new DataTexture(decoded.pixels, decoded.width, decoded.height, RGBAFormat, UnsignedByteType);
  texture.colorSpace = SRGBColorSpace;
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
  texture: DataTexture,
  maximumInstanceCount: number,
): EmitterBatch {
  const capacity = emitterCapacity(emitter) * maximumInstanceCount;
  const geometry = new InstancedBufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array([
    -0.5, -0.5, 0,
    0.5, -0.5, 0,
    0.5, 0.5, 0,
    -0.5, 0.5, 0,
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
  geometry.setAttribute("instanceOffset", offsets);
  geometry.setAttribute("instanceSize", sizes);
  geometry.setAttribute("instanceColor", colors);
  geometry.setAttribute("instanceRotation", rotations);
  geometry.setAttribute("instanceUvRect", uvRects);
  geometry.setAttribute("instanceVelocity", velocities);
  geometry.setAttribute("instanceAlphaCutoff", alphaCutoffs);
  geometry.instanceCount = 0;

  const velocityOriented = (emitter.flags & 0x4) !== 0;
  const alphaCutoff = emitter.blendingType === 4 ? "0.0039215686" : "0.0";
  const material = new ShaderMaterial({
    uniforms: { map: { value: texture } },
    vertexShader: `
      attribute vec3 instanceOffset;
      attribute vec2 instanceSize;
      attribute vec4 instanceColor;
      attribute float instanceRotation;
      attribute vec4 instanceUvRect;
      attribute vec3 instanceVelocity;
      attribute float instanceAlphaCutoff;
      varying float particleAlphaCutoff;
      varying vec2 particleUv;
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
        gl_Position = projectionMatrix * (center + vec4(rotated, 0.0, 0.0));
        particleUv = instanceUvRect.xy + uv * instanceUvRect.zw;
        particleColor = instanceColor;
        particleAlphaCutoff = instanceAlphaCutoff;
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 particleUv;
      varying vec4 particleColor;
      varying float particleAlphaCutoff;
      void main() {
        vec4 texel = texture2D(map, particleUv);
        float alpha = texel.a * particleColor.a;
        if (alpha <= max(${alphaCutoff}, particleAlphaCutoff)) discard;
        gl_FragColor = vec4(texel.rgb * particleColor.rgb, alpha);
        #include <colorspace_fragment>
      }
    `,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: emitter.blendingType === 2 ? NormalBlending
      : emitter.blendingType === 7 ? CustomBlending : AdditiveBlending,
    blendSrc: emitter.blendingType === 7 ? OneMinusSrcAlphaFactor : undefined,
    blendDst: emitter.blendingType === 7 ? OneFactor : undefined,
    blendSrcAlpha: emitter.blendingType === 7 ? OneMinusSrcAlphaFactor : undefined,
    blendDstAlpha: emitter.blendingType === 7 ? OneFactor : undefined,
    fog: false,
  });

  return { emitter, geometry, material, offsets, sizes, colors, rotations, uvRects, velocities, alphaCutoffs, capacity };
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
  readonly primaryOnlyEmitters: number[];
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
    this.unsupportedEmitters = model.emitters
      .filter((emitter) => (emitter.flags & 0x100000) !== 0)
      .map((emitter) => `emitter ${emitter.index}: refraction unsupported`);
    const renderedEmitters = model.emitters.filter((emitter) => (emitter.flags & 0x100000) === 0);
    if (renderedEmitters.length === 0 && model.ribbons.length === 0 && !skin) {
      throw new Error(`FileDataID ${model.fileDataId}: no supported authored emitters; ${this.unsupportedEmitters.join(", ")}.`);
    }
    this.renderedEmitterCount = renderedEmitters.length;
    this.primaryOnlyEmitters = renderedEmitters
      .filter((emitter) => emitter.textureIndices.length > 1
        && emitter.textureIndices.some((textureId) => textureId !== emitter.textureIndices[0]))
      .map((emitter) => emitter.index);
    this.maximumInstanceCount = maximumInstanceCount;
    this.textures = decodedTextures.map(createTexture);
    this.batches = renderedEmitters.map((emitter) => {
      const texture = this.textures[emitter.textureIndices[0]];
      if (!texture) throw new Error(`FileDataID ${model.fileDataId}: emitter ${emitter.index} texture is unavailable.`);
      return createEmitterBatch(emitter, texture, maximumInstanceCount);
    });

    for (const batch of this.batches) {
      const mesh = new Mesh(batch.geometry, batch.material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 100 + batch.emitter.priorityPlane;
      this.group.add(mesh);
    }
    this.ribbonLimitations = model.ribbons.flatMap((ribbon) => [
      ...(ribbon.materialIndices.length > 1 ? [`ribbon ${ribbon.index}: ${ribbon.materialIndices.length - 1} secondary materials not combined; first M2BLEND material only`] : []),
      ...(ribbon.textureIndices.length > 1 ? [`ribbon ${ribbon.index}: ${ribbon.textureIndices.length - 1} secondary texture slots not combined; original primary texture only`] : []),
      ...(ribbon.gravity !== 0 ? [`ribbon ${ribbon.index}: authored gravity ${ribbon.gravity} edge behavior not reconstructed`] : []),
      ...(ribbon.textureTransformLookupIndex !== 0 ? [`ribbon ${ribbon.index}: texture transform lookup ${ribbon.textureTransformLookupIndex} not applied`] : []),
      ...(ribbon.colorIndex !== 0 ? [`ribbon ${ribbon.index}: color index ${ribbon.colorIndex} not applied`] : []),
      ...((model.materials[ribbon.materialIndices[0]].flags & 0x140) !== 0 ? [`ribbon ${ribbon.index}: material flags 0x40 and 0x100 have unverified shadow/render semantics`] : []),
    ]);
    this.ribbonBatches = model.ribbons.map((ribbon) => {
      const materialSource = model.materials[ribbon.materialIndices[0]];
      if ((materialSource.flags & ~0x15d) !== 0) {
        throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} material flags 0x${materialSource.flags.toString(16)} contain unsupported bits.`);
      }
      if (materialSource.blendMode !== 2 && materialSource.blendMode !== 4) {
        throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} M2BLEND material ${materialSource.blendMode} is unsupported.`);
      }
      if (!(ribbon.edgesPerSecond > 0) || !(ribbon.edgeLifetime > 0) || !Number.isFinite(ribbon.edgesPerSecond * ribbon.edgeLifetime)) {
        throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} invalid authored edge rate or lifetime.`);
      }
      const capacity = (Math.ceil(ribbon.edgesPerSecond * ribbon.edgeLifetime) + 3) * maximumInstanceCount;
      if (capacity > 2048) throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} exceeds the 2048-edge resource bound.`);
      const geometry = new BufferGeometry();
      geometry.setAttribute("position", new BufferAttribute(new Float32Array(capacity * 6), 3).setUsage(DynamicDrawUsage));
      geometry.setAttribute("uv", new BufferAttribute(new Float32Array(capacity * 4), 2).setUsage(DynamicDrawUsage));
      geometry.setAttribute("ribbonColor", new BufferAttribute(new Float32Array(capacity * 8), 4).setUsage(DynamicDrawUsage));
      const indices = new Uint16Array((capacity - maximumInstanceCount) * 6);
      geometry.setIndex(new BufferAttribute(indices, 1));
      geometry.setDrawRange(0, 0);
      const texture = this.textures[ribbon.textureIndices[0]];
      if (!texture) throw new Error(`FileDataID ${model.fileDataId}: ribbon ${ribbon.index} primary texture is unavailable.`);
      const material = new ShaderMaterial({
        uniforms: { map: { value: texture } },
        vertexShader: `attribute vec4 ribbonColor; varying vec4 vRibbonColor; varying vec2 vRibbonUv;
          void main() { vRibbonColor = ribbonColor; vRibbonUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform sampler2D map; varying vec4 vRibbonColor; varying vec2 vRibbonUv;
          void main() { gl_FragColor = texture2D(map, vRibbonUv) * vRibbonColor;
            if (gl_FragColor.a < 0.00392157) discard;
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        transparent: true,
        blending: materialSource.blendMode === 4 ? AdditiveBlending : NormalBlending,
        depthWrite: (materialSource.flags & 0x10) !== 0,
        depthTest: (materialSource.flags & 0x8) !== 0,
        side: DoubleSide,
      });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = 100 + ribbon.priorityPlane;
      this.group.add(mesh);
      return { ribbon, geometry, material, mesh, capacity };
    });
    this.meshBatches = [];
    this.unsupportedMeshBatches = [];
    this.meshTriangleCount = skin ? skin.batches.reduce((total, batch) => total + skin.sections[batch.sectionIndex].indexCount / 3, 0) : 0;
    if (skin) {
      for (const [index, batch] of skin.batches.entries()) {
        const section = skin.sections[batch.sectionIndex];
        const material = model.materials[batch.materialIndex];
        if (!material || (material.blendMode !== 2 && material.blendMode !== 4) || (material.flags & ~0x11d5) !== 0
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
          const meshMaterial = new ShaderMaterial({
            uniforms: {
              primaryMap: { value: this.textures[textureIndices[0]] },
              secondaryMap: { value: this.textures[textureIndices[1]] },
              meshColor: { value: new Color(1, 1, 1) },
              meshOpacity: { value: 1 },
              secondaryUvScale: { value: new Vector2(1, 1) },
              secondaryUvTranslation: { value: new Vector2() },
            },
            vertexShader: `${batch.shaderId === 0x4014 ? "attribute vec2 secondaryUv;" : ""} uniform vec2 secondaryUvScale; uniform vec2 secondaryUvTranslation;
              varying vec2 primaryCoordinates; varying vec2 secondaryCoordinates;
              void main() {
                primaryCoordinates = uv;
                secondaryCoordinates = ${batch.shaderId === 0x4014 ? "secondaryUv * secondaryUvScale + secondaryUvTranslation" : "uv"};
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }`,
            fragmentShader: `uniform sampler2D primaryMap; uniform sampler2D secondaryMap;
              uniform vec3 meshColor; uniform float meshOpacity;
              varying vec2 primaryCoordinates; varying vec2 secondaryCoordinates;
              void main() {
                vec4 primary = texture2D(primaryMap, primaryCoordinates);
                vec4 secondary = texture2D(secondaryMap, secondaryCoordinates);
                gl_FragColor = vec4(meshColor * primary.rgb * secondary.rgb * 2.0,
                  meshOpacity * primary.a * secondary.a * 2.0);
                if (gl_FragColor.a < 0.00392157) discard;
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
              }`,
            transparent: true, blending: material.blendMode === 4 ? AdditiveBlending : NormalBlending,
            side: DoubleSide, depthTest: (material.flags & 0x8) === 0, depthWrite: (material.flags & 0x10) !== 0, fog: false,
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
        if (instance.timeSeconds < 0) continue;
        const headTime = Math.min(instance.timeSeconds, instance.emissionEndSeconds);
        const oldestTime = Math.max(0, instance.timeSeconds - ribbon.edgeLifetime);
        if (headTime <= oldestTime) continue;
        let previousEdge = -1;
        const sampleTimes: number[] = [];
        for (let time = headTime; time >= oldestTime; time -= 1 / ribbon.edgesPerSecond) sampleTimes.push(time);
        if (sampleTimes.at(-1)! > oldestTime) sampleTimes.push(oldestTime);
        for (const sampleTime of sampleTimes) {
          const timeMs = sampleTime * 1000;
          const enabled = sampleNativeTrack(ribbon.enabled, timeMs, duration, 1,
            this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
          if (enabled === 0) { previousEdge = -1; continue; }
          if (edgeCount >= batch.capacity) throw new Error(`FileDataID ${this.model.fileDataId}: ribbon ${ribbon.index} exceeds its ${batch.capacity}-edge resource bound.`);
          const position = ribbon.position;
          const above = sampleNativeTrack(ribbon.heightAbove, timeMs, duration, 0,
            this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
          const below = sampleNativeTrack(ribbon.heightBelow, timeMs, duration, 0,
            this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
          const translate = instance.sourceTranslationAtTime(sampleTime);
          const bone = this.model.bones[ribbon.boneIndex];
          for (const [side, height] of [above, -below].entries()) {
            const point = applyBonePoint([position[0], position[1], position[2] + height], bone,
              timeMs, duration, this.model.globalSequenceDurationsMs, this.model.bones, this.animationSequenceIndex);
            const converted = nativeToThree([translate[0] + point[0] * instance.modelScale,
              translate[1] + point[1] * instance.modelScale, translate[2] + point[2] * instance.modelScale]);
            positions.setXYZ(edgeCount * 2 + side, ...converted);
          }
          const color = sampleNativeTrack(ribbon.color, timeMs, duration, [1, 1, 1] as Vector3Tuple,
            this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
          const alpha = sampleNativeTrack(ribbon.alpha, timeMs, duration, 1,
            this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
          const slot = sampleNativeTrack(ribbon.textureSlot, timeMs, duration, 0,
            this.model.globalSequenceDurationsMs, this.animationSequenceIndex);
          const frame = Math.max(0, Math.min(ribbon.rows * ribbon.columns - 1, slot));
          const column = frame % ribbon.columns;
          const row = Math.floor(frame / ribbon.columns);
          const u = column / ribbon.columns;
          const v = 1 - (row + 1) / ribbon.rows;
          const along = (headTime - sampleTime) / ribbon.edgeLifetime;
          uvs.setXY(edgeCount * 2, u + along / ribbon.columns, v);
          uvs.setXY(edgeCount * 2 + 1, u + along / ribbon.columns, v + 1 / ribbon.rows);
          for (const side of [0, 1]) colors.setXYZW(edgeCount * 2 + side, color[0], color[1], color[2], alpha);
          if (previousEdge >= 0) {
            const next = edgeCount * 2;
            const previous = previousEdge * 2;
            for (const [offset, vertex] of [previous, previous + 1, next, previous + 1, next + 1, next].entries()) {
              indices.setX(triangleCount * 3 + offset, vertex);
            }
            triangleCount += 2;
          }
          previousEdge = edgeCount;
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
        const column = particle.uvFrame % batch.emitter.columns;
        const row = Math.floor(particle.uvFrame / batch.emitter.columns);
        const width = 1 / batch.emitter.columns;
        const height = 1 / batch.emitter.rows;
        batch.uvRects.setXYZW(index, column * width, 1 - (row + 1) * height, width, height);
        batch.velocities.setXYZ(index, ...velocity);
        batch.alphaCutoffs.setX(index, particle.alphaCutoff);
      });
      batch.geometry.instanceCount = particles.length;
      totalParticleCount += particles.length;
      batch.offsets.needsUpdate = true;
      batch.sizes.needsUpdate = true;
      batch.colors.needsUpdate = true;
      batch.rotations.needsUpdate = true;
      batch.uvRects.needsUpdate = true;
      batch.velocities.needsUpdate = true;
      batch.alphaCutoffs.needsUpdate = true;
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
      const source = nativeToThree(instance.sourceTranslationAtTime(instance.timeSeconds));
      batch.mesh.position.set(...source);
      batch.mesh.scale.setScalar(instance.modelScale);
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
      modelScale: 1, sourceTranslationAtTime: () => [0, 0, 0] as Vector3Tuple }];
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
