import { describe, expect, it } from "vitest";
import {
  parseAnimFile,
  parseM2File,
  parseSkelFile,
  parseSkinFile,
  readTrackKeys,
} from "./model";
import {
  buildAnimFixture,
  buildM2ModelFixture,
  buildSkinFixture,
  buildSkelFixture,
} from "./fixtures";

describe("parseM2File container walk", () => {
  it("retains unknown chunks opaquely and reads the dependency chunks", () => {
    const source = buildM2ModelFixture({
      fileDataId: 8001,
      skinFileDataIds: [478820, 3902868, 5746552],
      textureFileDataIds: [1378206, 0, 3552542],
      animationFiles: [{ animationId: 9, variationIndex: 0, fileDataId: 555001 }],
      skeletonFileDataId: 666002,
      extraChunks: [{ tag: "ZZZZ" }, { tag: "TXAC", payload: new Uint8Array([1, 0]) }],
    });

    const model = parseM2File(source, 8001);

    expect(model.chunkTags).toEqual(["MD21", "SFID", "TXID", "AFID", "SKID", "ZZZZ", "TXAC"]);
    expect(model.unknownChunkTags).toEqual(["ZZZZ", "TXAC"]);
    expect(model.skinFileDataIds).toEqual([478820, 3902868, 5746552]);
    expect(model.textureFileDataIds).toEqual([1378206, 0, 3552542]);
    expect(model.animationFileReferences).toEqual([
      { animationId: 9, variationIndex: 0, fileDataId: 555001 },
    ]);
    expect(model.skeletonFileDataId).toBe(666002);
  });

  it("rejects a truncated chunk header with FileDataID context", () => {
    const source = buildM2ModelFixture().slice(0, 6);
    expect(() => parseM2File(source, 8002)).toThrow(/FileDataID 8002.*chunk.*truncated/i);
  });

  it("rejects an MD21 payload that does not begin with MD20", () => {
    const source = buildM2ModelFixture();
    new DataView(source).setUint32(8, 0, true);
    expect(() => parseM2File(source, 8003)).toThrow(/FileDataID 8003.*MD20/i);
  });

  it("rejects an unsupported MD20 version", () => {
    expect(() => parseM2File(buildM2ModelFixture({ version: 264 }), 8004))
      .toThrow(/FileDataID 8004.*version 264.*supported/i);
  });
});

describe("parseM2File header", () => {
  it("reads the pinned header offsets", () => {
    const source = buildM2ModelFixture({
      name: "vulperamale_hd.m2",
      globalFlags: 0x202080,
      globalSequences: [1500, 0],
      sequences: [
        { animationId: 0, variationIndex: 0, durationMs: 1934, flags: 0x820, aliasNext: 3 },
        { animationId: 51, variationIndex: 2, durationMs: 667, flags: 0x40, variationNext: 7 },
      ],
      sequenceLookup: [0, -1, 1],
      viewCount: 2,
      boundingBox: [-2.41, -1.42, -0.57, 1.78, 1.4, 3.5],
      boundingRadius: 4.25,
    });

    const model = parseM2File(source, 8005);

    expect(model.version).toBe(274);
    expect(model.name).toBe("vulperamale_hd.m2");
    expect(model.globalFlags).toBe(0x202080);
    expect(model.globalSequenceDurationsMs).toEqual([1500, 0]);
    expect(model.viewCount).toBe(2);
    expect(model.boundingBox).toEqual({
      min: [-2.41, -1.42, -0.57].map((value) => expect.closeTo(value, 4)),
      max: [1.78, 1.4, 3.5].map((value) => expect.closeTo(value, 4)),
    });
    expect(model.boundingRadius).toBeCloseTo(4.25, 5);
    expect(model.collisionBox).toEqual({
      min: [-2.41, -1.42, -0.57].map((value) => expect.closeTo(value, 4)),
      max: [1.78, 1.4, 3.5].map((value) => expect.closeTo(value, 4)),
    });
    expect(model.sequences).toHaveLength(2);
    expect(model.sequences[0]).toMatchObject({
      index: 0,
      animationId: 0,
      variationIndex: 0,
      durationMs: 1934,
      flags: 0x820,
      aliasNext: 3,
      variationNext: -1,
    });
    expect(model.sequences[1]).toMatchObject({
      index: 1,
      animationId: 51,
      variationIndex: 2,
      durationMs: 667,
      flags: 0x40,
      variationNext: 7,
    });
    expect(model.sequenceLookup).toEqual([0, -1, 1]);
  });

  it("rejects a descriptor that points outside the MD21 payload", () => {
    const source = buildM2ModelFixture({ bones: [{ parent: -1 }] });
    const view = new DataView(source);
    const md21PayloadStart = 8;
    view.setUint32(md21PayloadStart + 0x30, 0x7ffff0, true);
    expect(() => parseM2File(source, 8006)).toThrow(/FileDataID 8006.*bone.*outside.*payload/i);
  });
});

describe("parseM2File geometry records", () => {
  it("decodes 0x30 vertices with raw bone weights, bone indices and two UV sets", () => {
    const source = buildM2ModelFixture({
      bones: [{}, {}],
      vertices: [
        {
          position: [1.5, -2, 3.25],
          boneWeights: [255, 0, 0, 0],
          boneIndices: [0, 1, 0, 0],
          normal: [0, 1, 0],
          uvs: [[0.25, 0.75], [0.5, 0.125]],
        },
      ],
    });

    const model = parseM2File(source, 8007);

    expect(model.vertices).toHaveLength(1);
    expect(model.vertices[0]).toEqual({
      position: [1.5, -2, 3.25],
      boneWeights: [255, 0, 0, 0],
      boneIndices: [0, 1, 0, 0],
      normal: [0, 1, 0],
      uvs: [[0.25, 0.75], [0.5, 0.125]],
    });
    expect(model.keyBoneLookup).toEqual([0, 1]);
  });

  it("reads bones with pivot, tracks and parents listed out of order", () => {
    const source = buildM2ModelFixture({
      sequences: [{ animationId: 0 }],
      bones: [
        { keyBoneId: 5, parent: 1, subMeshId: 3, pivot: [0.5, -1, 2] },
        { keyBoneId: 6, parent: -1, pivot: [0, 0, 0] },
      ],
    });

    const model = parseM2File(source, 8008);

    expect(model.bones).toHaveLength(2);
    expect(model.bones[0]).toMatchObject({
      index: 0,
      keyBoneId: 5,
      parentIndex: 1,
      subMeshId: 3,
      pivot: [0.5, -1, 2],
    });
    expect(model.bones[1]).toMatchObject({ index: 1, parentIndex: -1 });
    for (const track of ["translation", "rotation", "scale"] as const) {
      expect(model.bones[0][track]).toMatchObject({ interpolationMode: 0, globalSequence: -1 });
    }
    expect(model.bones[0].translation.valueType).toBe("float32x3");
    expect(model.bones[0].rotation.valueType).toBe("quaternion16");
  });

  it("rejects bone parent cycles and out-of-range parents", () => {
    const cycle = buildM2ModelFixture({
      bones: [{ parent: 1 }, { parent: 0 }],
    });
    expect(() => parseM2File(cycle, 8009)).toThrow(/FileDataID 8009.*bone.*cycle/i);

    const outOfRange = buildM2ModelFixture({ bones: [{ parent: 4 }] });
    expect(() => parseM2File(outOfRange, 8010)).toThrow(/FileDataID 8010.*bone 0.*parent 4/i);
  });

  it("reads textures, materials, transforms, replaceables and the lookup tables", () => {
    const source = buildM2ModelFixture({
      textures: [{ type: 1, flags: 0x1 }, { type: 3 }],
      materials: [{ flags: 0x11, blendMode: 2 }],
      textureTransforms: [
        {
          translation: { sequences: [{ timestamps: [0], values: [[0.5, 1, -0.5]] }] },
          rotation: { sequences: [{ timestamps: [0], values: [[0.1, -0.2, 0.3, 0.9]] }] },
        },
      ],
      replaceableLookup: [-1, 2],
      boneLookup: [3, 4],
      textureLookup: [1, 0],
      textureUnitLookup: [0, 1, 2],
      textureWeightLookup: [7],
      textureTransformLookup: [0, 0],
    });

    const model = parseM2File(source, 8011);

    expect(model.textures).toEqual([{ type: 1, flags: 0x1 }, { type: 3, flags: 0 }]);
    expect(model.materials).toEqual([{ flags: 0x11, blendMode: 2 }]);
    expect(model.textureTransforms).toHaveLength(1);
    expect(model.replaceableLookup).toEqual([-1, 2]);
    expect(model.boneLookup).toEqual([3, 4]);
    expect(model.textureLookup).toEqual([1, 0]);
    expect(model.textureUnitLookup).toEqual([0, 1, 2]);
    expect(model.textureWeightLookup).toEqual([7]);
    expect(model.textureTransformLookup).toEqual([0, 0]);

    const transform = model.textureTransforms[0];
    expect(transform.rotation.valueType).toBe("float32x4");
    expect(transform.translation.valueType).toBe("float32x3");
    const keys = readTrackKeys(model.payload, transform.rotation, 0);
    expect(keys.values[0]).toEqual([0.1, -0.2, 0.3, 0.9].map((value) => expect.closeTo(value, 5)));
  });

  it("reads attachments and the attachment lookup", () => {
    const source = buildM2ModelFixture({
      bones: [{}, {}, {}],
      attachments: [
        { id: 21, bone: 1, flags: 0x40, position: [0.25, -0.5, 0.75] },
        { id: 34, bone: 2, position: [-0.112, 0, 0.819] },
      ],
      attachmentLookup: [-1, -1, -1, 0, -1, 1],
    });

    const model = parseM2File(source, 8012);

    expect(model.attachments).toHaveLength(2);
    expect(model.attachments[0]).toMatchObject({
      id: 21,
      boneIndex: 1,
      flags: 0x40,
      position: [0.25, -0.5, 0.75],
    });
    expect(model.attachments[1]).toMatchObject({ id: 34, boneIndex: 2 });
    expect(model.attachmentLookup).toEqual([-1, -1, -1, 0, -1, 1]);
  });

  it("rejects a track descriptor that points outside the payload", () => {
    const source = buildM2ModelFixture({
      sequences: [{ animationId: 0 }],
      bones: [{ translation: { sequences: [{ timestamps: [0], values: [[1, 2, 3]] }] } }],
    });
    const view = new DataView(source);
    // The bone array descriptor lives at 0x2c/0x30; read the real bone offset from it.
    const boneArrayOffset = view.getUint32(8 + 0x30, true);
    // Translation track of bone 0 is at +0x10; its value-descriptor offset field at +0x10+12+4.
    view.setUint32(8 + boneArrayOffset + 0x10 + 12 + 4, 0x7fff00, true);
    expect(() => parseM2File(source, 8013)).toThrow(/FileDataID 8013.*translation.*outside.*payload/i);
  });
});

describe("parseSkinFile", () => {
  it("parses sections, batches and lookups with all batch fields", () => {
    const source = buildSkinFixture({
      vertexLookup: [2, 1, 0],
      indices: [0, 1, 2],
      bones: [[0, 0, 0, 0], [1, 0, 0, 0]],
      sections: [{ meshPartId: 501, vertexCount: 3, indexCount: 3, boneCount: 2, boneStart: 1 }],
      batches: [{
        flags: 0x8,
        priorityPlane: -2,
        shaderId: 0x4014,
        sectionIndex: 0,
        flags2: 0x10,
        colorIndex: -1,
        materialIndex: 2,
        materialLayer: 1,
        textureCount: 2,
        textureComboIndex: 0,
        textureCoordComboIndex: 1,
        textureWeightComboIndex: 2,
        textureTransformComboIndex: 3,
      }],
      shadowBatchCount: 1,
    });

    const skin = parseSkinFile(source, 8020);

    expect(skin.vertexLookup).toEqual([2, 1, 0]);
    expect(skin.indices).toEqual([0, 1, 2]);
    expect(skin.boneTable).toEqual([[0, 0, 0, 0], [1, 0, 0, 0]]);
    expect(skin.sections).toHaveLength(1);
    expect(skin.sections[0]).toMatchObject({
      index: 0,
      meshPartId: 501,
      level: 0,
      vertexStart: 0,
      vertexCount: 3,
      indexStart: 0,
      indexCount: 3,
      boneCount: 2,
      boneStart: 1,
      sortRadius: expect.closeTo(1, 5),
    });
    expect(skin.batches).toHaveLength(1);
    expect(skin.batches[0]).toEqual({
      index: 0,
      flags: 0x8,
      priorityPlane: -2,
      shaderId: 0x4014,
      sectionIndex: 0,
      flags2: 0x10,
      colorIndex: -1,
      materialIndex: 2,
      materialLayer: 1,
      textureCount: 2,
      textureComboIndex: 0,
      textureCoordComboIndex: 1,
      textureWeightComboIndex: 2,
      textureTransformComboIndex: 3,
    });
    expect(skin.shadowBatchCount).toBe(1);
  });

  it("extends only the triangle index start by the section level", () => {
    const source = buildSkinFixture({
      vertexLookup: [0, 1, 2],
      indices: [0, 1, 2],
      bones: [[0, 0, 0, 0]],
      sections: [{ vertexStart: 1, vertexCount: 2, indexStart: 0, indexCount: 3, level: 1 }],
      batches: [{}],
    });

    const skin = parseSkinFile(source, 8021);

    expect(skin.sections[0]).toMatchObject({
      level: 1,
      vertexStart: 1,
      indexStart: 65536,
      indexCount: 3,
    });
  });

  it("rejects out-of-range triangle indices with FileDataID context", () => {
    const source = buildSkinFixture({
      vertexLookup: [0, 1],
      indices: [0, 1, 2],
      bones: [[0, 0, 0, 0]],
      sections: [{ vertexCount: 2, indexCount: 3 }],
      batches: [{}],
    });
    expect(() => parseSkinFile(source, 8022)).toThrow(/FileDataID 8022.*triangle index 2.*outside/i);
  });

  it("rejects a missing SKIN magic", () => {
    const source = buildSkinFixture();
    new Uint8Array(source).set(new TextEncoder().encode("NOPE"), 0);
    expect(() => parseSkinFile(source, 8023)).toThrow(/FileDataID 8023.*SKIN magic/i);
  });
});

describe("parseAnimFile", () => {
  it("treats a raw animation file as its own payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const source = buildAnimFixture({ payload, mode: "raw" });

    const anim = parseAnimFile(source, 8030);

    expect(anim.fileDataId).toBe(8030);
    expect(Array.from(anim.payload.bytes)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(anim.payload.base).toBe(0);
  });

  it("prefers AFSB bytes over AFM2 and retains unknown chunks", () => {
    const real = new Uint8Array(64).fill(0xab);
    const decoy = new Uint8Array(64).fill(0xcd);
    const source = buildAnimFixture({
      payload: real,
      mode: "chunked",
      afm2Decoy: decoy,
      extraChunks: [{ tag: "AFEX", payload: new Uint8Array(2) }],
    });

    const anim = parseAnimFile(source, 8031);

    expect(Array.from(anim.payload.bytes.subarray(anim.payload.base, anim.payload.base + anim.payload.size)))
      .toEqual(Array.from(real));
    expect(Array.from(anim.payload.bytes.subarray(anim.payload.base, anim.payload.base + 4)))
      .not.toEqual(Array.from(decoy.subarray(0, 4)));
    expect(anim.chunkTags).toContain("AFSB");
    expect(anim.unknownChunkTags).toContain("AFEX");
  });

  it("uses AFM2 bytes when AFSB is absent", () => {
    const source = buildAnimFixture({ payload: new Uint8Array(16).fill(0x11), mode: "chunked" });
    const anim = parseAnimFile(source, 8032);
    expect(Array.from(anim.payload.bytes.subarray(anim.payload.base, anim.payload.base + anim.payload.size)))
      .toEqual(Array.from(new Uint8Array(16).fill(0x11)));
  });
});

describe("parseSkelFile", () => {
  it("parses SKS1 sequences, SKB1 bones, SKA1 attachments, SKPD parent and AFID", () => {
    const source = buildSkelFixture({
      fileDataId: 8040,
      globalSequences: [2500],
      sequences: [
        { animationId: 0, durationMs: 1934 },
        { animationId: 53, variationIndex: 1, durationMs: 667 },
      ],
      sequenceLookup: [0, -1, 1],
      bones: [
        { parent: -1, pivot: [0.25, 0, 1], translation: { sequences: [{ timestamps: [0], values: [[1, 2, 3]] }] } },
        { parent: 0 },
      ],
      parentSkeletonFileDataId: 8041,
      animationFiles: [{ animationId: 53, variationIndex: 1, fileDataId: 8042 }],
      attachments: [{ id: 34, bone: 1, position: [0, 0.5, 1] }],
      attachmentLookup: [-1, -1, -1, 0],
      extraChunks: [{ tag: "BFID", payload: new Uint8Array(8) }],
    });

    const skeleton = parseSkelFile(source, 8040);

    expect(skeleton.globalSequenceDurationsMs).toEqual([2500]);
    expect(skeleton.sequences).toHaveLength(2);
    expect(skeleton.sequences[1]).toMatchObject({ animationId: 53, variationIndex: 1, durationMs: 667 });
    expect(skeleton.sequenceLookup).toEqual([0, -1, 1]);
    expect(skeleton.bones).toHaveLength(2);
    expect(skeleton.bones[0].pivot).toEqual([0.25, 0, 1]);
    expect(skeleton.bones[1].parentIndex).toBe(0);
    expect(skeleton.parentSkeletonFileDataId).toBe(8041);
    expect(skeleton.animationFileReferences).toEqual([
      { animationId: 53, variationIndex: 1, fileDataId: 8042 },
    ]);
    expect(skeleton.attachments).toHaveLength(1);
    expect(skeleton.attachments[0]).toMatchObject({ id: 34, boneIndex: 1, position: [0, 0.5, 1] });
    expect(skeleton.attachmentLookup).toEqual([-1, -1, -1, 0]);
    expect(skeleton.unknownChunkTags).toContain("BFID");

    // Bone tracks resolve against the SKB1 payload, not the file start.
    const keys = readTrackKeys(skeleton.payload, skeleton.bones[0].translation, 0);
    expect(keys.timestamps).toEqual([0]);
    expect(keys.values[0]).toEqual([1, 2, 3].map((value) => expect.closeTo(value, 5)));
  });

  it("rejects a SKEL file without an SKB1 chunk", () => {
    const source = buildAnimFixture({ payload: new Uint8Array(8), mode: "raw" });
    expect(() => parseSkelFile(source, 8043)).toThrow(/FileDataID 8043.*SKB1/i);
  });
});
