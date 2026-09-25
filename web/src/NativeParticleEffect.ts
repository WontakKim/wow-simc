import {
  AdditiveBlending,
  BufferAttribute,
  Camera,
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
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
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
} from "three";
import { decodeNativeBlp } from "./nativeBlp";
import type { NativeEffectAsset } from "./nativeEffectAssets";
import { parseNativeM2, type NativeM2Model, type NativeParticleEmitter, type Vector3Tuple } from "./nativeM2";
import { sampleNativeEmitter, type NativeParticleSample } from "./nativeParticles";

const ASSET_ROOT = "/model/native-effects";
const SETUP_COMMAND = "node script/prepare-native-effects.mjs";

export interface NativeParticleRenderInstance {
  timeSeconds: number;
  emissionEndSeconds: number;
  modelScale: number;
  sourceTranslationAtTime: (timeSeconds: number) => Vector3Tuple;
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
  private readonly maximumInstanceCount: number;

  constructor(
    model: NativeM2Model,
    decodedTextures: ReturnType<typeof decodeNativeBlp>[],
    maximumInstanceCount = 1,
  ) {
    if (!Number.isInteger(maximumInstanceCount) || maximumInstanceCount < 1) {
      throw new Error(`FileDataID ${model.fileDataId}: native instance capacity must be a positive integer.`);
    }
    this.model = model;
    this.unsupportedEmitters = model.emitters
      .filter((emitter) => (emitter.flags & 0x100000) !== 0)
      .map((emitter) => `emitter ${emitter.index}: refraction unsupported`);
    const renderedEmitters = model.emitters.filter((emitter) => (emitter.flags & 0x100000) === 0);
    if (renderedEmitters.length === 0) {
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
    this.group.name = `Native M2 FileDataID ${model.fileDataId}`;
    this.group.position.set(-0.15, 1.2, 0);
    this.group.scale.setScalar(0.38);
  }

  private renderInstances(instances: NativeParticleRenderInstance[], camera: Camera) {
    if (instances.length > this.maximumInstanceCount) {
      throw new Error(
        `FileDataID ${this.model.fileDataId}: ${instances.length} simultaneous component instances exceed the ${this.maximumInstanceCount}-instance resource bound.`,
      );
    }

    this.group.updateWorldMatrix(true, false);
    const localCamera = this.group.worldToLocal(camera.getWorldPosition(new Vector3()));
    let totalParticleCount = 0;
    for (const batch of this.batches) {
      let particles = instances.flatMap((instance) => sampleNativeEmitter(
        batch.emitter,
        this.model.bones[batch.emitter.boneIndex],
        this.model.sequenceDurationMs,
        instance.timeSeconds,
        { ...instance, bones: this.model.bones, globalSequenceDurationsMs: this.model.globalSequenceDurationsMs },
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

  setTime(timeSeconds: number, camera: Camera) {
    return this.renderInstances([{
      timeSeconds,
      emissionEndSeconds: Number.POSITIVE_INFINITY,
      modelScale: 1,
      sourceTranslationAtTime: () => [0, 0, 0],
    }], camera);
  }

  setReplayInstances(instances: NativeParticleRenderInstance[], camera: Camera) {
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.group.scale.setScalar(1);
    return this.renderInstances(instances, camera);
  }

  clearInstances() {
    for (const batch of this.batches) batch.geometry.instanceCount = 0;
  }

  dispose() {
    for (const batch of this.batches) {
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

async function fetchPinnedAsset(fileDataId: number, extension: "m2" | "blp", expectedSha256: string) {
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
    return new NativeParticleEffect(model, decodedTextures, maximumInstanceCount);
  } catch (caught) {
    const reason = caught instanceof Error ? caught.message : "Unknown native asset failure.";
    throw new Error(`${reason} No substitute effect was rendered.`);
  }
}
