/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AdditiveBlending,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
  PerspectiveCamera,
} from "three";
import { describe, expect, it } from "vitest";
import { decodeNativeBlp } from "./nativeBlp";
import { parseNativeM2 } from "./nativeM2";
import { NativeParticleEffect } from "./NativeParticleEffect";

function loadAsset(fileDataId: number, extension: "m2" | "blp") {
  const path = resolve(process.cwd(), `public/model/native-effects/${fileDataId}.${extension}`);
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

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
