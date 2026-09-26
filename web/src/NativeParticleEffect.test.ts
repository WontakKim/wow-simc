/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MeshBasicMaterial,
  RepeatWrapping,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  PerspectiveCamera,
} from "three";
import { describe, expect, it } from "vitest";
import { decodeNativeBlp } from "./nativeBlp";
import { parseNativeM2, parseNativeSkin } from "./nativeM2";
import { NativeParticleEffect } from "./NativeParticleEffect";
import * as particleSampling from "./nativeParticles";

function loadAsset(fileDataId: number, extension: "m2" | "blp" | "skin") {
  const path = resolve(process.cwd(), `public/model/native-effects/${fileDataId}.${extension}`);
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("original Lava Burst ribbon rendering", () => {
  it("draws bounded original ribbon geometry with M2BLEND material modes and deterministic scrubbing", () => {
    const model = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 2);
    const ribbons = effect.group.children.slice(-3) as Mesh<BufferGeometry, ShaderMaterial>[];
    expect(ribbons.map((mesh) => mesh.material.blending)).toEqual([AdditiveBlending, NormalBlending, NormalBlending]);
    const instance = { timeSeconds: 0.415, emissionEndSeconds: 0.8, modelScale: 0.38,
      sourceTranslationAtTime: (time: number): [number, number, number] => [-4 + time * 10, 0, 0] };
    const camera = new PerspectiveCamera();
    effect.setReplayInstances([instance], camera);
    expect(ribbons.every((mesh) => mesh.geometry.drawRange.count > 0)).toBe(true);
    expect(Array.from(ribbons[1].geometry.index!.array).slice(0, 12)).toEqual([0, 1, 2, 1, 3, 2, 2, 3, 4, 3, 5, 4]);
    const first = ribbons.map((mesh) => ({ count: mesh.geometry.drawRange.count,
      positions: Array.from(mesh.geometry.getAttribute("position").array),
      indices: Array.from(mesh.geometry.index!.array) }));
    effect.setReplayInstances([{ ...instance, timeSeconds: 0.7 }], camera);
    effect.setReplayInstances([instance], camera);
    expect(ribbons.map((mesh) => ({ count: mesh.geometry.drawRange.count,
      positions: Array.from(mesh.geometry.getAttribute("position").array),
      indices: Array.from(mesh.geometry.index!.array) }))).toEqual(first);
    expect(() => effect.setReplayInstances([instance, instance, instance], camera)).toThrow(/FileDataID 4329984.*3 simultaneous.*2-instance/i);
    effect.clearInstances();
    expect(ribbons.every((mesh) => mesh.geometry.drawRange.count === 0)).toBe(true);
    effect.dispose();
  });
});

describe("original Lightning Bolt missile rendering", () => {
  it("scrubs four overlapping additive LOD0 meshes and all five genuine particle emitters", () => {
    const model = parseNativeM2(loadAsset(6211617, "m2"), 6211617);
    const skin = parseNativeSkin(loadAsset(6212146, "skin"), 6212146, model.vertices.length);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 4, skin);
    expect(effect.renderedEmitterCount).toBe(5);
    expect(effect.meshTriangleCount).toBe(64);
    expect(effect.animationSequenceIndex).toBe(0);
    expect(skin.batches[0].shaderId).toBe(0x14);
    expect(model.textureLookup.slice(0, 2)).toEqual([7, 7]);
    expect(model.textureTransformLookup.slice(0, 2)).toEqual([0, 0]);
    expect(model.textureTransforms[0].scale.sequences.every((sequence) =>
      sequence.values.every(([x, y]) => x === 1 && y === 1))).toBe(true);
    const alteredTransform = { ...model.textureTransforms[0], scale: { ...model.textureTransforms[0].scale,
      sequences: [{ timestamps: [0], values: [[2, 1, 0] as [number, number, number]] }] } };
    expect(() => new NativeParticleEffect({ ...model, textureTransforms: [...model.textureTransforms, alteredTransform],
      textureTransformLookup: [0, 1] }, textures, 4, skin)).toThrow(/T1\/T1 UV transform is not identity/);
    expect(effect.unsupportedMeshBatches.join(" ")).not.toContain("native combiner");
    expect(effect.unsupportedMeshBatches.join(" ")).not.toContain("material flags 0x80");
    expect(effect.group.children).toHaveLength(9);
    const meshes = effect.group.children.slice(5) as Mesh<BufferGeometry, ShaderMaterial>[];
    expect(meshes.every((mesh) => mesh.material.blending === AdditiveBlending
      && mesh.material.uniforms.primaryMap.value === mesh.material.uniforms.secondaryMap.value
      && mesh.material.fragmentShader.includes("primary.rgb * secondary.rgb * 2.0")
      && mesh.material.fragmentShader.includes("primary.a * secondary.a * 2.0")
      && !mesh.geometry.hasAttribute("secondaryUv")
      && mesh.material.vertexShader.includes("secondaryCoordinates = uv"))).toBe(true);
    const camera = new PerspectiveCamera();
    const instance = (timeSeconds: number, start: number) => ({ timeSeconds, emissionEndSeconds: 0.8,
      modelScale: 0.38, sourceTranslationAtTime: (time: number): [number, number, number] => [start + time * 10, 0, 0] });
    const instances = [instance(0.45, -4), instance(0.3, -3), instance(0.15, -2), instance(0.05, 1)];
    effect.setReplayInstances(instances, camera);
    expect(meshes.every((mesh) => mesh.visible && mesh.geometry.drawRange.count === 192)).toBe(true);
    expect(new Set(meshes.map((mesh) => mesh.position.x)).size).toBe(4);
    const positions = meshes.map((mesh) => Array.from(mesh.geometry.getAttribute("position").array));
    effect.setReplayInstances([instance(0.75, 2)], camera);
    effect.setReplayInstances(instances, camera);
    expect(meshes.map((mesh) => Array.from(mesh.geometry.getAttribute("position").array))).toEqual(positions);
    expect(() => effect.setReplayInstances([...instances, instance(0.01, 3)], camera)).toThrow(/FileDataID 6211617.*5 simultaneous.*4-instance/i);
    effect.clearInstances();
    expect(meshes.every((mesh) => !mesh.visible)).toBe(true);
    effect.dispose();
  });
});

describe("NativeParticleEffect source rendering", () => {
  it.each([794788, 613807])("uses authored blend modes and shader-safe scaled billboards for FileDataID %i", (fileDataId) => {
    const model = parseNativeM2(loadAsset(fileDataId, "m2"), fileDataId);
    const textures = model.textureFileDataIds.map((textureFileDataId) =>
      decodeNativeBlp(loadAsset(textureFileDataId, "blp"), textureFileDataId));
    const effect = new NativeParticleEffect(model, textures);
    const meshes = effect.group.children as Mesh<InstancedBufferGeometry, ShaderMaterial>[];

    expect(meshes).toHaveLength(6);
    for (const [index, mesh] of meshes.entries()) {
      expect(mesh.material.blending).toBe(
        model.emitters[index].blendingType === 2 ? NormalBlending : AdditiveBlending,
      );
      expect(mesh.geometry.getAttribute("position").itemSize).toBe(3);
      expect(mesh.material.vertexShader).not.toMatch(/attribute vec[23] (position|uv)/);
      expect(mesh.material.vertexShader).toContain("length(modelViewMatrix[0].xyz)");
      expect(mesh.material.fragmentShader).toContain("#include <colorspace_fragment>");
    }

    effect.dispose();
  });

  it("uses inverse-source-alpha additive factors for original blend 7 and skips only the refraction emitter", () => {
    const model = parseNativeM2(loadAsset(4006621, "m2"), 4006621);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    expect(effect.renderedEmitterCount).toBe(8);
    expect(effect.unsupportedEmitters).toEqual(["emitter 4: refraction unsupported"]);
    expect(effect.group.children).toHaveLength(8);
    const blendSeven = model.emitters.findIndex((emitter) => emitter.blendingType === 7);
    const material = (effect.group.children[blendSeven] as Mesh<InstancedBufferGeometry, ShaderMaterial>).material;
    expect(material.blending).toBe(CustomBlending);
    expect(material.blendSrc).toBe(OneMinusSrcAlphaFactor);
    expect(material.blendDst).toBe(OneFactor);
    expect(material.blendSrcAlpha).toBe(OneMinusSrcAlphaFactor);
    expect(material.blendDstAlpha).toBe(OneFactor);
    effect.dispose();
  });

  it("allocates for the full authored variation amplitude and disposes every GPU resource", () => {
    const sourceModel = parseNativeM2(loadAsset(794788, "m2"), 794788);
    const textures = sourceModel.textureFileDataIds.map((textureFileDataId) =>
      decodeNativeBlp(loadAsset(textureFileDataId, "blp"), textureFileDataId));
    const emitter = {
      ...sourceModel.emitters[0],
      emissionRate: {
        ...sourceModel.emitters[0].emissionRate,
        sequences: [{ timestamps: [0], values: [10] }],
      },
      emissionRateVariation: 4,
      lifespan: {
        ...sourceModel.emitters[0].lifespan,
        sequences: [{ timestamps: [0], values: [2] }],
      },
      lifespanVariation: 1,
    };
    const model = { ...sourceModel, emitters: [emitter] };
    const effect = new NativeParticleEffect(model, textures);
    const mesh = effect.group.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>;
    const expectedCapacity = Math.ceil((10 + 4) * (2 + 1 + 0.1)) + 8;
    expect(mesh.geometry.getAttribute("instanceOffset").count).toBe(expectedCapacity);

    let geometryDisposals = 0;
    let materialDisposals = 0;
    let textureDisposals = 0;
    mesh.geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
    mesh.material.addEventListener("dispose", () => { materialDisposals += 1; });
    mesh.material.uniforms.map.value.addEventListener("dispose", () => { textureDisposals += 1; });
    const parent = new Mesh();
    parent.add(effect.group);
    effect.dispose();

    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
    expect(textureDisposals).toBe(1);
    expect(effect.group.parent).toBeNull();
  });

  it("reuses bounded instance buffers for concurrent absolute-time replay samples", () => {
    const model = parseNativeM2(loadAsset(613807, "m2"), 613807);
    const textures = model.textureFileDataIds.map((textureFileDataId) =>
      decodeNativeBlp(loadAsset(textureFileDataId, "blp"), textureFileDataId));
    const effect = new NativeParticleEffect(model, textures, 2);
    const camera = new PerspectiveCamera();
    const geometry = (effect.group.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>).geometry;
    const offsetAttribute = geometry.getAttribute("instanceOffset");
    effect.setReplayInstances([
      { timeSeconds: 0.4, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTranslationAtTime: () => [0, 0, 0] },
      { timeSeconds: 0.2, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTranslationAtTime: () => [1, 0, 0] },
    ], camera);

    expect(geometry.getAttribute("instanceOffset")).toBe(offsetAttribute);
    expect(geometry.instanceCount).toBeGreaterThan(0);
    effect.clearInstances();
    expect(geometry.instanceCount).toBe(0);
    expect(() => effect.setReplayInstances([
      { timeSeconds: 0.1, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTranslationAtTime: () => [0, 0, 0] },
      { timeSeconds: 0.1, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTranslationAtTime: () => [1, 0, 0] },
      { timeSeconds: 0.1, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTranslationAtTime: () => [2, 0, 0] },
    ], camera)).toThrow(/3 simultaneous component instances.*2-instance resource bound/);
    effect.dispose();
  });
});


describe("mesh bone weighting", () => {
  it("blends authored vertex weights through recursively composed parent transforms", () => {
    const model = parseNativeM2(loadAsset(4290517, "m2"), 4290517);
    const track = (value: [number, number, number]) => ({
      interpolation: 0 as const, globalSequence: -1,
      sequences: [{ timestamps: [0], values: [value] }],
    });
    const bones = [
      { ...model.bones[0], pivot: [0, 0, 0] as [number, number, number], translation: track([1, 0, 0]) },
      { ...model.bones[1], parentIndex: 0, pivot: [0, 0, 0] as [number, number, number], translation: track([0, 2, 0]) },
    ];
    const vertex = { ...model.vertices[0], position: [0, 0, 0] as [number, number, number],
      boneWeights: [128, 127, 0, 0] as [number, number, number, number],
      boneIndices: [0, 1, 0, 0] as [number, number, number, number] };
    const sample = (particleSampling as Record<string, unknown>).sampleNativeSkinnedVertex as
      ((vertex: typeof model.vertices[number], bones: typeof model.bones, timeMs: number, sequenceMs: number) => [number, number, number]) | undefined;
    expect(sample?.(vertex, bones, 0, model.sequenceDurationMs)).toEqual([1, 254 / 255, 0]);
  });
});


describe("original mesh component rendering", () => {
  it("combines both original Ancestral Swiftness textures with scrubbed secondary UV animation", () => {
    const model = parseNativeM2(loadAsset(4290517, "m2"), 4290517);
    const skin = parseNativeSkin(loadAsset(4291424, "skin"), 4291424, model.vertices.length);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 1, skin);
    expect(effect.group.children).toHaveLength(5);
    expect(effect.meshTriangleCount).toBe(900);
    expect(skin.batches[0].shaderId).toBe(0x4014);
    expect(skin.batches[0].textureCount).toBe(2);
    expect(model.textureFileDataIds[model.textureLookup[1]]).toBe(4281028);
    expect(model.textureTransformLookup.slice(0, 2)).toEqual([-1, 0]);
    expect(effect.unsupportedMeshBatches.join(" ")).not.toContain("secondary texture unit not implemented");
    const renamedModel = new NativeParticleEffect({ ...model, fileDataId: 9999 }, textures, 1, skin);
    expect(renamedModel.animationSequenceIndex).toBe(2);
    renamedModel.dispose();
    const mesh = effect.group.children[4] as Mesh;
    expect(mesh.geometry.getAttribute("position").count).toBe(612);
    expect(mesh.geometry.index?.count).toBe(2700);
    const material = mesh.material as ShaderMaterial;
    expect(material.side).toBe(DoubleSide);
    expect(material.depthWrite).toBe(true);
    expect(material.depthTest).toBe(true);
    expect(material.uniforms.primaryMap.value.wrapS).toBe(RepeatWrapping);
    expect(material.uniforms.secondaryMap.value.image.width).toBe(256);
    expect(material.fragmentShader).toContain("primary.rgb * secondary.rgb * 2.0");
    expect(material.fragmentShader).toContain("primary.a * secondary.a * 2.0");
    expect(mesh.geometry.getAttribute("secondaryUv").count).toBe(612);
    const originalUv = (mesh.geometry.getAttribute("uv") as BufferAttribute).array.slice(0, 2);
    effect.setTime(0.04, new PerspectiveCamera());
    expect(material.uniforms.meshOpacity.value).toBeGreaterThan(0);
    expect(effect.animationSequenceIndex).toBe(2);
    const alpha = model.colors[skin.batches[0].colorIndex].alpha;
    expect(particleSampling.sampleNativeTrack(alpha, 40, model.sequenceDurationsMs[0], 1, model.globalSequenceDurationsMs)).toBe(0);
    expect(particleSampling.sampleNativeTrack(alpha, 40, model.sequenceDurationsMs[2], 1, model.globalSequenceDurationsMs, 2)).toBeGreaterThan(0);
    expect(Array.from((mesh.geometry.getAttribute("uv") as BufferAttribute).array.slice(0, 2))).toEqual(Array.from(originalUv));
    effect.setTime(0.15, new PerspectiveCamera());
    expect(material.uniforms.meshOpacity.value).toBeLessThan(0.8);
    expect(material.uniforms.secondaryUvScale.value.toArray().slice(0, 2)).toEqual([0.25, 1]);
    expect(material.uniforms.secondaryUvTranslation.value.x).toBeCloseTo(0.15, 2);
    effect.setTime(0.30, new PerspectiveCamera());
    expect(material.uniforms.secondaryUvTranslation.value.x).toBeCloseTo(0.30, 2);
    effect.setTime(0.15, new PerspectiveCamera());
    expect(material.uniforms.secondaryUvTranslation.value.x).toBeCloseTo(0.15, 2);
    effect.setReplayInstances([{ timeSeconds: 0.04, emissionEndSeconds: 0.2, modelScale: 0.38,
      sourceTranslationAtTime: () => [-4, 0, 1] }], new PerspectiveCamera());
    expect(mesh.position.toArray()).toEqual([-4, -1, 0]);
    expect(mesh.scale.x).toBe(0.38);
    expect(() => effect.setReplayInstances([
      { timeSeconds: 0.04, emissionEndSeconds: 0.2, modelScale: 0.38, sourceTranslationAtTime: () => [0, 0, 0] },
      { timeSeconds: 0.15, emissionEndSeconds: 0.2, modelScale: 0.38, sourceTranslationAtTime: () => [0, 0, 0] },
    ], new PerspectiveCamera())).toThrow(/simultaneous mesh instances exceed the 1-instance/i);
    effect.clearInstances();
    expect(mesh.visible).toBe(false);
    let geometryDisposals = 0;
    let materialDisposals = 0;
    let textureDisposals = 0;
    mesh.geometry.addEventListener("dispose", () => { geometryDisposals += 1; });
    material.addEventListener("dispose", () => { materialDisposals += 1; });
    material.uniforms.primaryMap.value.addEventListener("dispose", () => { textureDisposals += 1; });
    effect.dispose();
    expect([geometryDisposals, materialDisposals, textureDisposals]).toEqual([1, 1, 1]);
  });
});
