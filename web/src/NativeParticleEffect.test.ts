/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  MeshBasicMaterial,
  Matrix4,
  Quaternion,
  RepeatWrapping,
  CustomBlending,
  OneFactor,
  OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
  ZeroFactor,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  PerspectiveCamera,
  Vector3,
} from "three";
import { describe, expect, it } from "vitest";
import { decodeNativeBlp } from "./nativeBlp";
import { nativeToThreeMatrix } from "./m2/coordinates";
import { parseNativeM2, parseNativeSkin } from "./nativeM2";
import { applyM2Blend, fogM2BlendColor, m2BlendParams } from "./nativeM2Blend";
import { getNativeEffectTailBound, NativeParticleEffect } from "./NativeParticleEffect";
import * as particleSampling from "./nativeParticles";

function translationMatrix(x: number, y: number, z: number) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

function loadAsset(fileDataId: number, extension: "m2" | "blp" | "skin") {
  const path = resolve(process.cwd(), `public/model/native-effects/${fileDataId}.${extension}`);
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

describe("original Lava Burst ribbon rendering", () => {
  it("renders emitted particles and ribbon edges after arrival until the pinned M2 tail bound", () => {
    const model = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    const camera = new PerspectiveCamera();
    const instance = { timeSeconds: 0.8, emissionEndSeconds: 0.8, modelScale: 0.38,
      sourceTransformAtTime: () => translationMatrix(0, 0, 0) };
    const atStop = effect.setReplayInstances([instance], camera);
    const ribbons = effect.group.children.filter((child) => (child as Mesh<BufferGeometry>).geometry instanceof BufferGeometry
      && !((child as Mesh).geometry instanceof InstancedBufferGeometry)) as Mesh<BufferGeometry>[];
    expect(atStop).toBeGreaterThan(0);
    expect(ribbons.some((mesh) => mesh.geometry.drawRange.count > 0)).toBe(true);
    expect(effect.setReplayInstances([{ ...instance, timeSeconds: 1.801 }], camera)).toBe(0);
    expect(ribbons.every((mesh) => mesh.geometry.drawRange.count === 0)).toBe(true);
    effect.setReplayInstances([instance], camera);
    expect(effect.setReplayInstances([instance], camera)).toBe(atStop);
    effect.dispose();
  });

  it("draws bounded original ribbon geometry with M2BLEND material modes and deterministic scrubbing", () => {
    const model = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 2);
    const ribbons = effect.group.children.slice(-3) as Mesh<BufferGeometry, ShaderMaterial>[];
    expect(ribbons.map((mesh) => mesh.material.blending)).toEqual([CustomBlending, CustomBlending, CustomBlending]);
    expect(ribbons.every((mesh) => mesh.material.toneMapped === false
      && !mesh.material.fragmentShader.includes("<tonemapping_fragment>")
      && !mesh.material.fragmentShader.includes("<colorspace_fragment>"))).toBe(true);
    expect(ribbons.map((mesh) => [mesh.material.blendSrc, mesh.material.blendDst,
      mesh.material.blendSrcAlpha, mesh.material.blendDstAlpha])).toEqual([
      [SrcAlphaFactor, OneFactor, ZeroFactor, OneFactor],
      [SrcAlphaFactor, OneMinusSrcAlphaFactor, OneFactor, OneMinusSrcAlphaFactor],
      [SrcAlphaFactor, OneMinusSrcAlphaFactor, OneFactor, OneMinusSrcAlphaFactor],
    ]);
    const instance = { timeSeconds: 0.415, emissionEndSeconds: 0.8, modelScale: 0.38,
      sourceTransformAtTime: (time: number) => translationMatrix(-4 + time * 10, 0, 0) };
    const camera = new PerspectiveCamera();
    effect.setReplayInstances([instance], camera);
    expect(ribbons.slice(1).every((mesh) => mesh.geometry.drawRange.count > 0)).toBe(true);
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

describe("authored mesh attachment frame", () => {
  it("bounds tails by authored particle lifespan and ribbon edge age, and stops mesh at the emission boundary", () => {
    const model = parseNativeM2(loadAsset(6211617, "m2"), 6211617);
    expect(getNativeEffectTailBound(model)).toBeCloseTo(0.8);
    expect(getNativeEffectTailBound({ ...model, emitters: [{ ...model.emitters[0],
      lifespan: { ...model.emitters[0].lifespan, sequences: [] }, lifespanVariation: 0.1 }], ribbons: [] }))
      .toBeCloseTo(0.15);
    expect(getNativeEffectTailBound({ ...model, emitters: [{ ...model.emitters[0],
      lifespan: { ...model.emitters[0].lifespan, sequences: [
        { timestamps: [0], values: [0.01] }, { timestamps: [], values: [] },
      ] }, lifespanVariation: 0.1 }], ribbons: [] })).toBeCloseTo(0.15);
    const ribbonModel = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    expect(getNativeEffectTailBound(ribbonModel)).toBeCloseTo(1);
    expect(getNativeEffectTailBound({ ...ribbonModel, emitters: [],
      ribbons: [{ ...ribbonModel.ribbons[0], edgeLifetime: 0.1 }] })).toBe(0.25);
    const skin = parseNativeSkin(loadAsset(6212146, "skin"), 6212146, model.vertices.length);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 1, skin);
    const camera = new PerspectiveCamera();
    const instance = { timeSeconds: 0.199, emissionEndSeconds: 0.2, modelScale: 0.38,
      sourceTransformAtTime: () => translationMatrix(0, 0, 0) };
    effect.setReplayInstances([instance], camera);
    const visibleMeshes = () => effect.group.children.filter((child) => child.visible
      && (child as Mesh).geometry instanceof BufferGeometry
      && Boolean((child as Mesh<BufferGeometry>).geometry.getAttribute("normal")));
    expect(visibleMeshes()).toHaveLength(1);
    effect.setReplayInstances([{ ...instance, timeSeconds: 0.2 }], camera);
    expect(visibleMeshes()).toHaveLength(0);
    effect.dispose();
  });

  it("applies the source orientation and scale to the original missile mesh", () => {
    const model = parseNativeM2(loadAsset(6211617, "m2"), 6211617);
    const skin = parseNativeSkin(loadAsset(6212146, "skin"), 6212146, model.vertices.length);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 1, skin);
    const authored = new Matrix4().makeRotationZ(Math.PI / 2)
      .scale(new Vector3(1.5, 1.5, 1.5)).setPosition(1, 2, 3).toArray();
    effect.setReplayInstances([{ timeSeconds: 0.1, emissionEndSeconds: 0.2, modelScale: 0.38,
      sourceTransformAtTime: () => authored }], new PerspectiveCamera());
    const mesh = effect.group.children.slice(5).find((child) => child.visible) as Mesh;
    const expectedPosition = new Vector3();
    const expectedRotation = new Quaternion();
    const expectedScale = new Vector3();
    new Matrix4().fromArray(nativeToThreeMatrix(authored))
      .decompose(expectedPosition, expectedRotation, expectedScale);
    expect(mesh.position.distanceTo(expectedPosition)).toBeLessThan(1e-6);
    expect(mesh.quaternion.angleTo(expectedRotation)).toBeLessThan(1e-6);
    expect(mesh.scale.distanceTo(expectedScale.multiplyScalar(0.38))).toBeLessThan(1e-6);
    effect.dispose();
  });
});

describe("original particle texture alpha", () => {
  it("tests blend-7 texture alpha without changing the authored color equation", () => {
    const model = parseNativeM2(loadAsset(6211618, "m2"), 6211618);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const texture = textures[3];
    expect(Array.from({ length: texture.pixels.length / 4 }, (_, pixel) => pixel)
      .some((pixel) => texture.pixels[pixel * 4 + 3] === 0
        && (texture.pixels[pixel * 4] || texture.pixels[pixel * 4 + 1] || texture.pixels[pixel * 4 + 2]))).toBe(true);
    const effect = new NativeParticleEffect(model, textures);
    const blendAdd = (effect.group.children as Mesh<InstancedBufferGeometry, ShaderMaterial>[])
      .find((mesh) => mesh.material.uniforms.uFogBlendMode.value === 7)!;
    expect(blendAdd.material.blendSrc).toBe(OneFactor);
    const shader = blendAdd.material.fragmentShader;
    expect(blendAdd.material.uniforms.uAlphaTest.value).toBe(Math.fround(1 / 255));
    expect(shader.indexOf("if (tex1.a < uAlphaTest) discard;")).toBeLessThan(shader.indexOf("vec4 combined ="));
    expect(shader).toContain("float alpha = combined.a * uAlphaMult;");
    expect(shader).toContain("if (alpha < uAlphaTest) discard;");
    expect(shader).toContain("if (alpha < particleAlphaCutoff) discard;");
    expect(shader.indexOf("float alpha = combined.a * uAlphaMult;")).toBeLessThan(shader.indexOf("if (alpha < uAlphaTest) discard;"));
    expect(shader.indexOf("if (alpha < uAlphaTest) discard;")).toBeLessThan(shader.indexOf("if (alpha < particleAlphaCutoff) discard;"));
    expect(shader).toContain("applyEffectFog(combined.rgb * uColorMult, alpha)");
    effect.dispose();
  });

  it("identifies the Stormkeeper square's opaque BC1 glow and additive emitter", () => {
    const model = parseNativeM2(loadAsset(1355634, "m2"), 1355634);
    expect(model.textureFileDataIds[model.emitters[1].textureIndices[0]]).toBe(167007);
    expect(model.emitters[1].blendingType).toBe(4);
    const glow = decodeNativeBlp(loadAsset(167007, "blp"), 167007);
    expect(glow).toMatchObject({ width: 128, height: 128, compression: "BC1" });
    expect(Array.from(glow.pixels.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(glow.pixels.slice((64 * glow.width + 64) * 4, (64 * glow.width + 64) * 4 + 4)))
      .toEqual([247, 251, 255, 255]);
    const background: [number, number, number, number] = [0.53, 0.48, 0.37, 1];
    const foggedBorder = fogM2BlendColor(4, [0, 0, 0], [0.65, 0.72, 0.78], 1);
    expect(applyM2Blend(4, [...foggedBorder, 1], background)).toEqual(background);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    const glowMaterial = (effect.group.children[1] as Mesh<InstancedBufferGeometry, ShaderMaterial>).material;
    expect([glowMaterial.blendSrc, glowMaterial.blendDst]).toEqual([SrcAlphaFactor, OneFactor]);
    expect(glowMaterial.uniforms.uFogBlendMode.value).toBe(4);
    expect(glowMaterial.fragmentShader).toContain("(uFogBlendMode == 3 || uFogBlendMode == 4) ? vec3(0.0)");
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
    expect(meshes.every((mesh) => mesh.material.blending === CustomBlending
      && mesh.material.blendSrc === SrcAlphaFactor
      && mesh.material.blendDst === OneFactor
      && mesh.material.blendSrcAlpha === ZeroFactor
      && mesh.material.blendDstAlpha === OneFactor
      && mesh.material.depthWrite === false
      && mesh.material.depthTest === true
      && mesh.material.uniforms.primaryMap.value === mesh.material.uniforms.secondaryMap.value
      && mesh.material.fragmentShader.includes("primary.rgb * secondary.rgb * 2.0")
      && mesh.material.fragmentShader.includes("primary.a * secondary.a * 2.0")
      && mesh.material.toneMapped === false
      && !mesh.material.fragmentShader.includes("<tonemapping_fragment>")
      && !mesh.material.fragmentShader.includes("<colorspace_fragment>")
      && !mesh.geometry.hasAttribute("secondaryUv")
      && mesh.material.vertexShader.includes("secondaryCoordinates = uv"))).toBe(true);
    const camera = new PerspectiveCamera();
    const instance = (timeSeconds: number, start: number) => ({ timeSeconds, emissionEndSeconds: 0.8,
      modelScale: 0.38, sourceTransformAtTime: (time: number) => translationMatrix(start + time * 10, 0, 0) });
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
      const blend = m2BlendParams(model.emitters[index].blendingType);
      expect(mesh.material.blending).toBe(CustomBlending);
      expect([mesh.material.blendSrc, mesh.material.blendDst,
        mesh.material.blendSrcAlpha, mesh.material.blendDstAlpha]).toEqual(
        [blend.blendSrc, blend.blendDst, blend.blendSrcAlpha, blend.blendDstAlpha]);
      expect(mesh.material.depthWrite).toBe(false);
      expect(mesh.geometry.getAttribute("position").itemSize).toBe(3);
      expect(mesh.material.vertexShader).not.toMatch(/attribute vec[23] (position|uv)/);
      expect(mesh.material.vertexShader).toContain("length(modelViewMatrix[0].xyz)");
      expect(mesh.material.toneMapped).toBe(false);
      expect(mesh.material.fragmentShader).not.toContain("<tonemapping_fragment>");
      expect(mesh.material.fragmentShader).not.toContain("<colorspace_fragment>");
    }

    effect.dispose();
  });

  it("uses original blend 7 premultiplied factors and skips only refraction emitters", () => {
    const model = parseNativeM2(loadAsset(4006621, "m2"), 4006621);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    expect(effect.renderedEmitterCount).toBe(8);
    expect(effect.unsupportedEmitters).toEqual(["emitter 4: refraction unsupported"]);
    expect(effect.group.children).toHaveLength(8);
    // Rendered children keep emitter order except e4; e3 is the first blend-7 emitter.
    const blendSeven = model.emitters.findIndex((emitter) => emitter.blendingType === 7);
    expect(blendSeven).toBe(3);
    const material = (effect.group.children[3] as Mesh<InstancedBufferGeometry, ShaderMaterial>).material;
    expect(material.blending).toBe(CustomBlending);
    expect(material.blendSrc).toBe(OneFactor);
    expect(material.blendDst).toBe(OneMinusSrcAlphaFactor);
    expect(material.blendSrcAlpha).toBe(OneFactor);
    expect(material.blendDstAlpha).toBe(OneMinusSrcAlphaFactor);
    effect.dispose();
  });

  it("combines the three authored textures per emitter with scrolled secondary UVs", () => {
    const model = parseNativeM2(loadAsset(6211617, "m2"), 6211617);
    const skin = parseNativeSkin(loadAsset(6212146, "skin"), 6212146, model.vertices.length);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 1, skin);
    const emitters = effect.group.children.slice(0, 5) as Mesh<InstancedBufferGeometry, ShaderMaterial>[];
    expect(emitters.map((mesh) => mesh.material.uniforms.uPixelShader.value)).toEqual([2, 2, 2, 1, 2]);
    for (const [index, mesh] of emitters.entries()) {
      const emitter = model.emitters[index];
      const textureUniforms = [mesh.material.uniforms.map, mesh.material.uniforms.map2, mesh.material.uniforms.map3];
      for (const [unit, uniform] of textureUniforms.entries()) {
        expect(uniform.value.image.data).toBe(textures[emitter.textureIndices[unit]].pixels);
      }
      expect(mesh.geometry.getAttribute("instanceUvScroll1").itemSize).toBe(2);
      expect(mesh.geometry.getAttribute("instanceUvScroll2").itemSize).toBe(2);
    }
    expect(emitters[0].material.fragmentShader).toContain("tex1 * tex2 * tex3 * particleColor");
    expect(emitters[3].material.fragmentShader).toContain("tex1.a * tex2.a * tex3.a * particleColor.a");
    expect(emitters[3].material.fragmentShader).not.toContain("tex1 * tex2 * tex3 * particleColor");
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
      { timeSeconds: 0.4, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(0, 0, 0) },
      { timeSeconds: 0.2, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(1, 0, 0) },
    ], camera);

    expect(geometry.getAttribute("instanceOffset")).toBe(offsetAttribute);
    expect(geometry.instanceCount).toBeGreaterThan(0);
    effect.clearInstances();
    expect(geometry.instanceCount).toBe(0);
    expect(() => effect.setReplayInstances([
      { timeSeconds: 0.1, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(0, 0, 0) },
      { timeSeconds: 0.1, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(1, 0, 0) },
      { timeSeconds: 0.1, emissionEndSeconds: 0.8, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(2, 0, 0) },
    ], camera)).toThrow(/3 simultaneous component instances.*2-instance resource bound/);
    effect.dispose();
  });
});


describe("mesh bone weighting", () => {  it("blends authored vertex weights through recursively composed parent transforms", () => {
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
    // PS3-selected emitters 0 and 3 render with the reference PS2 color equation.
    expect(effect.renderedEmitterCount).toBe(4);
    expect(effect.unsupportedEmitters).toEqual([]);
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
    expect(material.depthWrite).toBe(false);
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
      sourceTransformAtTime: () => translationMatrix(-4, 2, 1) }], new PerspectiveCamera());
    expect(mesh.position.toArray()).toEqual([-4, 1, -2]);
    expect(mesh.scale.x).toBe(0.38);
    expect(() => effect.setReplayInstances([
      { timeSeconds: 0.04, emissionEndSeconds: 0.2, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(0, 0, 0) },
      { timeSeconds: 0.15, emissionEndSeconds: 0.2, modelScale: 0.38, sourceTransformAtTime: () => translationMatrix(0, 0, 0) },
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


describe("reference simulation semantics (M0b)", () => {
  it("builds quad corners at the full ±1 extent", () => {
    const model = parseNativeM2(loadAsset(794788, "m2"), 794788);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    for (const child of effect.group.children) {
      const mesh = child as Mesh<InstancedBufferGeometry, ShaderMaterial>;
      const corners = Array.from(mesh.geometry.getAttribute("position").array as Float32Array);
      const xComponents = corners.filter((_, index) => index % 3 === 0).map(Math.abs);
      const yComponents = corners.filter((_, index) => index % 3 === 1).map(Math.abs);
      expect(Math.max(...xComponents)).toBeCloseTo(1, 5);
      expect(Math.max(...yComponents)).toBeCloseTo(1, 5);
    }
    effect.dispose();
  });

  it("dispatches authored head and tail quads with velocity-trail age clamping", () => {
    const original = parseNativeM2(loadAsset(794788, "m2"), 794788);
    const emitter = { ...original.emitters[0], flags: original.emitters[0].flags | 0x40000 | 0x400,
      tailLength: 0.3 };
    const model = { ...original, emitters: [emitter] };
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    expect(effect.renderedEmitterCount).toBe(1);
    expect(effect.group.children).toHaveLength(2);
    const [head, tail] = effect.group.children as Mesh<InstancedBufferGeometry, ShaderMaterial>[];
    expect(head.material.vertexShader).not.toContain("viewTrail");
    expect(tail.material.vertexShader).toContain("viewTrail");
    expect(tail.material.vertexShader).toContain("min(instanceAge, 0.30000000)");
    effect.setTime(0.4, new PerspectiveCamera());
    expect(tail.geometry.instanceCount).toBe(head.geometry.instanceCount);
    effect.dispose();
  });

  it("renders PS3-selected emitters with the reference color equation", () => {
    const model = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    expect(effect.renderedEmitterCount).toBe(10);
    expect(effect.unsupportedEmitters).toEqual([]);
    expect(effect.group.children).toHaveLength(13);
    // Emitter 0 selects pixel shader 3; it renders with the PS2 combiner line.
    const ps3 = effect.group.children[0] as Mesh<InstancedBufferGeometry, ShaderMaterial>;
    expect(ps3.material.uniforms.uPixelShader.value).toBe(3);
    expect(ps3.material.fragmentShader).toContain("tex1 * tex2 * tex3 * particleColor");
    effect.dispose();
  });

  it("renders the nonzero-TXAC emitters of 4006621 and 4290517 instead of skipping them", () => {
    const lava = parseNativeM2(loadAsset(4006621, "m2"), 4006621);
    const lavaTextures = lava.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const lavaEffect = new NativeParticleEffect(lava, lavaTextures);
    expect(lavaEffect.renderedEmitterCount).toBe(8);
    expect(lavaEffect.unsupportedEmitters).toEqual(["emitter 4: refraction unsupported"]);
    expect(lavaEffect.group.children).toHaveLength(8);
    lavaEffect.dispose();

    const ancestral = parseNativeM2(loadAsset(4290517, "m2"), 4290517);
    const ancestralTextures = ancestral.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const skin = parseNativeSkin(loadAsset(4291424, "skin"), 4291424, ancestral.vertices.length);
    const ancestralEffect = new NativeParticleEffect(ancestral, ancestralTextures, 1, skin);
    expect(ancestralEffect.renderedEmitterCount).toBe(4);
    expect(ancestralEffect.unsupportedEmitters).toEqual([]);
    ancestralEffect.dispose();
  });

  it("renders one ribbon pass per authored material with its corresponding texture", () => {
    const original = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    const ribbon = { ...original.ribbons[1], materialIndices: [
      original.ribbons[1].materialIndices[0], original.ribbons[2].materialIndices[0],
    ], textureIndices: original.ribbons[1].textureIndices.slice(0, 2) };
    const model = { ...original, emitters: [], ribbons: [ribbon] };
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures);
    expect(effect.group.children).toHaveLength(2);
    const [first, second] = effect.group.children as Mesh<BufferGeometry, ShaderMaterial>[];
    expect(first.material.uniforms.map.value.image.data).toBe(textures[ribbon.textureIndices[0]].pixels);
    expect(second.material.uniforms.map.value.image.data).toBe(textures[ribbon.textureIndices[1]].pixels);
    effect.setTime(0.4, new PerspectiveCamera());
    expect(first.geometry.drawRange.count).toBeGreaterThan(0);
    expect(second.geometry.drawRange.count).toBe(first.geometry.drawRange.count);
    effect.dispose();
  });

  it("keeps ribbon edges drawing and aging after emission stops", () => {
    const model = parseNativeM2(loadAsset(4329984, "m2"), 4329984);
    const textures = model.textureFileDataIds.map((id) => decodeNativeBlp(loadAsset(id, "blp"), id));
    const effect = new NativeParticleEffect(model, textures, 1);
    const ribbons = effect.group.children.slice(-3) as Mesh<BufferGeometry, ShaderMaterial>[];
    const camera = new PerspectiveCamera();
    const instance = (timeSeconds: number) => ({ timeSeconds, emissionEndSeconds: 0.8, modelScale: 0.38,
      occurrenceSeed: "cast-1", sourceTransformAtTime: (time: number) => translationMatrix(-4 + time * 10, 0, 0) });

    effect.setReplayInstances([instance(0.5)], camera);
    expect(ribbons.slice(1).every((mesh) => mesh.geometry.drawRange.count > 0)).toBe(true);
    const midFrame = ribbons.map((mesh) => Array.from((mesh.geometry.getAttribute("position") as BufferAttribute).array));

    // 0.24 s past the emission end the remaining edges still draw and have sagged further.
    effect.setReplayInstances([instance(1.04)], camera);
    expect(ribbons.slice(1).every((mesh) => mesh.geometry.drawRange.count > 0)).toBe(true);
    const lateFrame = ribbons.map((mesh) => Array.from((mesh.geometry.getAttribute("position") as BufferAttribute).array));
    expect(JSON.stringify(lateFrame)).not.toBe(JSON.stringify(midFrame));

    // After every edge exceeds its lifetime the ribbons are empty again.
    effect.setReplayInstances([instance(1.4)], camera);
    expect(ribbons.every((mesh) => mesh.geometry.drawRange.count === 0)).toBe(true);
    effect.dispose();
  });
});
