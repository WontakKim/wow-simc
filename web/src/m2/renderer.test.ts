import { describe, expect, it } from "vitest";
import { CustomBlending, DataTexture, DoubleSide, FrontSide, Matrix4, RepeatWrapping, ClampToEdgeWrapping, Vector3, Vector4 } from "three";
import { buildM2ModelFixture, buildSkinFixture } from "./fixtures";
import { parseM2File, parseSkinFile } from "./model";
import { createNativeM2Actor } from "./renderer";
import { resolveSequence } from "./sampler";
import type { M2Model, M2Skin } from "./model";

function buildActorFixture(shadowBatchCount = 0) {
  const model: M2Model = parseM2File(buildM2ModelFixture({
    fileDataId: 9001,
    name: "renderer-fixture.m2",
    sequences: [{ animationId: 0, durationMs: 1000, flags: 0x20 }],
    sequenceLookup: [0],
    bones: [{ pivot: [0, 0, 0] }],
    vertices: Array.from({ length: 8 }, (_, index) => ({
      position: [index % 4, Math.floor(index / 4), 0.1 * index] as [number, number, number],
      normal: [0, 0, 1] as [number, number, number],
      uvs: [[0.25 * index, 0.5], [0.75, 0.125 * index]] as Array<[number, number]>,
      boneWeights: [255, 0, 0, 0] as [number, number, number, number],
      boneIndices: [0, 0, 0, 0] as [number, number, number, number],
    })),
    textures: [
      { type: 0, flags: 1 },
      { type: 11, flags: 0 },
      { type: 0, flags: 3 },
    ],
    textureFileDataIds: [101, 0, 103],
    materials: [
      { flags: 0x15, blendMode: 7 },
      { flags: 0x0, blendMode: 1 },
      { flags: 0x0, blendMode: 0 },
    ],
    textureTransforms: [
      { translation: { sequences: [{ timestamps: [0, 1000], values: [[0, 0, 0], [0.5, 0, 0]] }] } },
    ],
    textureLookup: [0, 1, 1, 2],
    textureTransformLookup: [65535, 0],
    textureWeightLookup: [0],
    attachments: [{ id: 34, bone: 0, position: [0.1, 0.2, 0.3] }],
  }), 9001);

  const skin: M2Skin = parseSkinFile(buildSkinFixture({
    fileDataId: 9002,
    vertexLookup: [0, 1, 2, 3, 4, 5, 6, 7],
    shadowBatchCount,
    indices: [0, 1, 2, 1, 3, 2, 4, 5, 6, 5, 7, 6],
    sections: [
      { meshPartId: 0, vertexStart: 0, vertexCount: 4, indexStart: 0, indexCount: 6 },
      { meshPartId: 1702, vertexStart: 4, vertexCount: 4, indexStart: 6, indexCount: 6 },
    ],
    batches: [
      {
        shaderId: 0x4011, textureCount: 2, sectionIndex: 0, materialIndex: 0,
        priorityPlane: 1, materialLayer: 1,
        textureComboIndex: 1, textureCoordComboIndex: 0,
        textureWeightComboIndex: 0, textureTransformComboIndex: 0,
      },
      { shaderId: 0x10, textureCount: 1, sectionIndex: 1, materialIndex: 1, textureComboIndex: 3 },
      { shaderId: 0x0, textureCount: 1, sectionIndex: 0, materialIndex: 2, textureComboIndex: 0 },
    ],
  }), 9002);

  return { model, skin };
}

function makeTexture(fill: number) {
  const data = new Uint8Array([fill, fill, fill, 255]);
  return new DataTexture(data, 1, 1);
}

describe("createNativeM2Actor", () => {
  it("renders every primary batch even when a separate shadow array is present", () => {
    const { model, skin } = buildActorFixture(1);
    const actor = createNativeM2Actor({ model, skin, label: "shadow-fixture", textures: new Map() });

    expect(skin.shadowBatchCount).toBe(1);
    expect(actor.batches.map(({ batch }) => batch.index)).toEqual([0, 1, 2]);
    expect(actor.root.children).toHaveLength(3);
    actor.dispose();
  });

  it("builds one mesh per batch over section-scoped geometry", () => {
    const { model, skin } = buildActorFixture();
    const actor = createNativeM2Actor({
      model,
      skin,
      label: "fixture",
      textures: new Map([[0, makeTexture(10)], [2, makeTexture(20)]]),
    });

    expect(actor.batches).toHaveLength(3);
    const [twoUnit, alphaKey, opaque] = actor.batches;
    expect(twoUnit.mesh.geometry).toBe(opaque.mesh.geometry);
    expect(twoUnit.mesh.geometry.index!.count).toBe(6);
    expect(twoUnit.mesh.geometry.getAttribute("position").count).toBe(4);
    expect(twoUnit.mesh.geometry.getAttribute("uv").count).toBe(4);
    expect(twoUnit.mesh.geometry.getAttribute("uv2").count).toBe(4);
    expect(actor.root.children.length).toBeGreaterThanOrEqual(3);
  });

  it("maps material render flags and blend modes onto the batch materials", () => {
    const { model, skin } = buildActorFixture();
    const actor = createNativeM2Actor({
      model,
      skin,
      label: "fixture",
      textures: new Map([[0, makeTexture(10)], [2, makeTexture(20)]]),
    });

    const [twoUnit, alphaKey, opaque] = actor.batches;
    // flags 0x15: unlit, two-sided, no depth write.
    expect(twoUnit.material.side).toBe(DoubleSide);
    expect(twoUnit.material.depthWrite).toBe(false);
    expect(twoUnit.material.depthTest).toBe(true);
    expect(twoUnit.material.uniforms.u_apply_lighting.value).toBe(0);
    expect(twoUnit.material.transparent).toBe(true);
    expect(twoUnit.material.blending).toBe(CustomBlending);
    expect(twoUnit.material.uniforms.u_vertex_shader.value).toBe(2);
    expect(twoUnit.material.uniforms.u_pixel_shader.value).toBe(6);
    expect(twoUnit.material.uniforms.u_blend_mode.value).toBe(7);

    // flags 0x0, blend 1: alpha-key discard.
    expect(alphaKey.material.side).toBe(FrontSide);
    expect(alphaKey.material.depthWrite).toBe(true);
    expect(alphaKey.material.uniforms.u_apply_lighting.value).toBe(1);
    expect(alphaKey.material.uniforms.u_pixel_shader.value).toBe(1);
    expect(alphaKey.material.uniforms.u_alpha_test.value).toBeCloseTo(0.501960814, 9);

    expect(opaque.material.transparent).toBe(false);
    expect(opaque.material.uniforms.u_blend_mode.value).toBe(0);
  });

  it("hides sections whose geoset is hidden by default and orders batches by priority plane and layer", () => {
    const { model, skin } = buildActorFixture();
    const actor = createNativeM2Actor({
      model,
      skin,
      label: "fixture",
      textures: new Map([[0, makeTexture(10)], [2, makeTexture(20)]]),
    });

    const [twoUnit, alphaKey, opaque] = actor.batches;
    expect(alphaKey.mesh.visible).toBe(false);
    expect(twoUnit.mesh.visible).toBe(true);
    // priority plane 1 sorts after both priority-0 batches; blend mode breaks the tie below it.
    expect(opaque.mesh.renderOrder).toBeLessThan(alphaKey.mesh.renderOrder);
    expect(alphaKey.mesh.renderOrder).toBeLessThan(twoUnit.mesh.renderOrder);
  });

  it("binds provided textures, wrap flags, replaceable slots and a neutral grey fallback", () => {
    const { model, skin } = buildActorFixture();
    const provided = new Map([[0, makeTexture(10)], [2, makeTexture(20)]]);
    const actor = createNativeM2Actor({ model, skin, label: "fixture", textures: provided });

    const [twoUnit, alphaKey, opaque] = actor.batches;
    expect(opaque.material.uniforms.u_texture1.value).toBe(provided.get(0));
    expect(provided.get(0)!.wrapS).toBe(RepeatWrapping);
    expect(provided.get(0)!.wrapT).toBe(ClampToEdgeWrapping);
    expect(alphaKey.material.uniforms.u_texture1.value).toBe(provided.get(2));
    expect(provided.get(2)!.wrapS).toBe(RepeatWrapping);
    expect(provided.get(2)!.wrapT).toBe(RepeatWrapping);

    expect(actor.pendingTextureTypes).toEqual([11]);
    expect(actor.statusLines.some((line) => /types 11/.test(line))).toBe(true);
    const fallback = twoUnit.material.uniforms.u_texture1.value as DataTexture;
    const pixels = fallback.image.data as Uint8Array;
    expect([pixels[0], pixels[1], pixels[2], pixels[3]]).toEqual([128, 128, 128, 255]);

    const replacement = makeTexture(77);
    const complete = createNativeM2Actor({
      model,
      skin,
      label: "fixture",
      textures: provided,
      replaceableTextures: new Map([[11, replacement]]),
    });
    expect(complete.pendingTextureTypes).toEqual([]);
    expect(complete.batches[0].material.uniforms.u_texture1.value).toBe(replacement);
    expect(complete.batches[0].material.uniforms.u_texture2.value).toBe(replacement);
  });

  it("uploads blended bone matrices through the bone data texture", () => {
    const { model, skin } = buildActorFixture();
    const actor = createNativeM2Actor({
      model,
      skin,
      label: "fixture",
      textures: new Map([[0, makeTexture(10)], [2, makeTexture(20)]]),
    });

    const boneTexture = actor.batches[0].material.uniforms.u_bone_texture.value as DataTexture;
    expect(boneTexture.image.height).toBe(1);
    const before = Float32Array.from(boneTexture.image.data as Float32Array);

    const translated = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
    actor.setPose([translated]);
    const after = boneTexture.image.data as Float32Array;
    expect(after[12]).toBeCloseTo(5, 6);
    expect(Array.from(after)).not.toEqual(Array.from(before));
  });

  it("applies the first texture weight once to mesh opacity without sampling adjacent batch stages", () => {
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, durationMs: 1000, flags: 0x20 }],
      sequenceLookup: [0],
      bones: [{ pivot: [0, 0, 0] }],
      vertices: Array.from({ length: 3 }, () => ({ boneWeights: [255, 0, 0, 0] as [number, number, number, number] })),
      textures: [{ type: 0 }],
      textureLookup: [0],
      materials: [{ flags: 1, blendMode: 2 }],
      textureWeights: [0, 16384, 32767].map((weight) => ({
        sequences: [{ timestamps: [0], values: [[weight]] }],
      })),
      textureWeightLookup: [0, 1, 2, 65535],
    }), 9020);
    const skin = parseSkinFile(buildSkinFixture({
      vertexLookup: [0, 1, 2], indices: [0, 1, 2],
      sections: [{ meshPartId: 0, vertexStart: 0, vertexCount: 3, indexStart: 0, indexCount: 3 }],
      batches: [
        { shaderId: 0x10, textureCount: 1, textureWeightComboIndex: 0 },
        { shaderId: 0x10, textureCount: 1, textureWeightComboIndex: 1 },
        { shaderId: 0x10, textureCount: 1, textureWeightComboIndex: 2 },
        { shaderId: 0, textureCount: 1, textureWeightComboIndex: 0, flags: 0x40 },
        { shaderId: 0, textureCount: 0, textureWeightComboIndex: 0 },
        { shaderId: 0, textureCount: 1, textureWeightComboIndex: 8 },
        { shaderId: 0, textureCount: 1, textureWeightComboIndex: 3 },
        { shaderId: 0x8010, textureCount: 2, textureWeightComboIndex: 1, flags: 0x40 },
      ],
    }), 9021);
    const actor = createNativeM2Actor({ model, skin, label: "opacity-fixture", textures: new Map() });
    actor.updateAnimatedTracks(resolveSequence(model, 0)!, 0);

    const opacity = actor.batches.map(({ material }) => (material.uniforms.u_mesh_color.value as Vector4).w);
    expect(opacity).toEqual([0, 0.5, 32767 / 32768, 1, 1, 1, 1, 1]);
    const weights = actor.batches.map(({ material }) => (material.uniforms.u_tex_sample_alpha.value as Vector3).toArray());
    expect(weights).toEqual([
      [0, 1, 1], [0.5, 1, 1], [32767 / 32768, 1, 1], [0, 1, 1],
      [1, 1, 1], [1, 1, 1], [1, 1, 1], [0.5, 32767 / 32768, 1],
    ]);
    expect(actor.batches.map(({ material }) => material.visible)).toEqual([false, true, true, true, true, true, true, true]);
    actor.dispose();

    const emptyLookupActor = createNativeM2Actor({
      model: { ...model, textureWeightLookup: [] }, skin, label: "empty-lookup-fixture", textures: new Map(),
    });
    emptyLookupActor.updateAnimatedTracks(resolveSequence(model, 0)!, 0);
    expect(emptyLookupActor.batches[0].material.uniforms.u_mesh_color.value.w).toBe(1);
    expect((emptyLookupActor.batches[0].material.uniforms.u_tex_sample_alpha.value as Vector3).toArray()).toEqual([1, 1, 1]);
    emptyLookupActor.dispose();
  });

  it("samples animated UV transform matrices per texture unit", () => {
    const { model, skin } = buildActorFixture();
    const actor = createNativeM2Actor({
      model,
      skin,
      label: "fixture",
      textures: new Map([[0, makeTexture(10)], [2, makeTexture(20)]]),
    });
    const resolution = resolveSequence(model, 0)!;

    actor.updateAnimatedTracks(resolution, 0);
    const first = (actor.batches[0].material.uniforms.u_tex_matrix2.value as Matrix4).clone();
    expect(first.equals(new Matrix4())).toBe(true);

    actor.updateAnimatedTracks(resolution, 1000);
    const moved = actor.batches[0].material.uniforms.u_tex_matrix2.value as Matrix4;
    expect(moved.elements[12]).toBeCloseTo(0.5, 6);
    expect((actor.batches[0].material.uniforms.u_tex_matrix1.value as Matrix4).equals(new Matrix4())).toBe(true);
  });
});
