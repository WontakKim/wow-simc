/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  AdditiveBlending,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  ShaderMaterial,
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
});
