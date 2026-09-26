import { describe, expect, it } from "vitest";
import { parseAnimFile, parseM2File, parseSkinFile, parseSkelFile } from "./model";
import type { AnimFile, M2Model } from "./model";
import {
  attachmentMatrix,
  computeSkinnedVertexBounds,
  composeBoneMatrix,
  decodePackedQuaternion,
  findSequences,
  resolveSequence,
  sampleBoneMatrices,
  slerpQuaternion,
} from "./sampler";
import { geosetIdFromMeshPartId, isGeosetVisibleByDefault } from "./geosets";
import { buildM2ModelFixture, buildSkinFixture, buildSkelFixture } from "./fixtures";

const applyMatrix = (m: number[], v: [number, number, number]): [number, number, number] => [
  m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12],
  m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13],
  m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14],
];

/** Inverse of decodePackedQuaternion: encodes floats as unsigned u16 components. */
const encodePackedQuaternion = (x: number, y: number, z: number, w: number) =>
  [x, y, z, w].map((component) => Math.round(32767 + component * 32768));

/** Extracts the MD21 chunk payload from a built model fixture. */
const md21PayloadOf = (source: ArrayBuffer): Uint8Array => {
  const view = new DataView(source);
  const size = view.getUint32(4, true);
  return new Uint8Array(source, 8, size);
};

const identityQuaternion: [number, number, number, number] = [0, 0, 0, 1];

describe("decodePackedQuaternion", () => {
  it("decodes the identity encoding to [0, 0, 0, 1]", () => {
    expect(decodePackedQuaternion([32767, 32767, 32767, 65535])).toEqual([
      expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(0, 6), expect.closeTo(1, 6),
    ]);
  });

  it("maps unsigned components with (u - 32767) / 32768 and normalizes", () => {
    const allZero = decodePackedQuaternion([0, 0, 0, 0]);
    // Every component decodes to ~-1; normalization yields -0.5 each.
    expect(allZero).toEqual([-0.5, -0.5, -0.5, -0.5].map((value) => expect.closeTo(value, 6)));

    const packed = encodePackedQuaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2);
    const decoded = decodePackedQuaternion(packed);
    expect(decoded[0]).toBeCloseTo(0, 6);
    expect(decoded[1]).toBeCloseTo(0, 6);
    expect(decoded[2]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(decoded[3]).toBeCloseTo(Math.SQRT1_2, 3);
    const norm = Math.hypot(...decoded);
    expect(norm).toBeCloseTo(1, 6);
  });
});

describe("slerpQuaternion", () => {
  it("takes the shortest path for antipodal quaternions", () => {
    const halfway = slerpQuaternion(identityQuaternion, [0, 0, 0, -1], 0.5);
    expect(halfway).toEqual([0, 0, 0, 1].map((value) => expect.closeTo(value, 6)));

    const quarter = slerpQuaternion(identityQuaternion, [0, 0, 0, -1], 0.25);
    expect(quarter[3]).toBeCloseTo(1, 6);
  });

  it("interpolates quarter turns identically for both representations of the end rotation", () => {
    const positive = [0, 0, Math.SQRT1_2, Math.SQRT1_2] as [number, number, number, number];
    const negative = [-positive[0], -positive[1], -positive[2], -positive[3]] as [number, number, number, number];
    const half = slerpQuaternion(identityQuaternion, positive, 0.5);
    const halfNegated = slerpQuaternion(identityQuaternion, negative, 0.5);
    expect(half).toEqual(halfNegated.map((value) => expect.closeTo(value, 5)));
    expect(half[2]).toBeCloseTo(Math.sin(Math.PI / 8), 5);
    expect(half[3]).toBeCloseTo(Math.cos(Math.PI / 8), 5);
    expect(Math.hypot(...half)).toBeCloseTo(1, 6);
  });
});

describe("sequence resolution", () => {
  it("prefers the lookup table, honoring -1 entries and variations", () => {
    const source = buildM2ModelFixture({
      sequences: [
        { animationId: 7, variationIndex: 0, flags: 0x20 },
        { animationId: 0, variationIndex: 0, flags: 0x20 },
        { animationId: 0, variationIndex: 1, flags: 0x20 },
      ],
      sequenceLookup: [1, -1, 2],
    });
    const model = parseM2File(source, 8050);

    const stand = resolveSequence(model, 0);
    expect(stand?.sequence.index).toBe(1);
    expect(stand?.payload).toBe(model.payload);

    // Beyond the lookup range, scanning finds the exact variation first.
    const variation = resolveSequence(model, 0, { variationIndex: 1 });
    expect(variation?.sequence.index).toBe(2);

    const anim7 = resolveSequence(model, 7);
    expect(anim7?.sequence.index).toBe(0);
    expect(findSequences(model, 0).map((sequence) => sequence.index)).toEqual([1, 2]);
  });

  it("falls back to scanning sequences when the lookup misses", () => {
    const source = buildM2ModelFixture({
      sequences: [{ animationId: 828, variationIndex: 0, flags: 0x20 }],
      sequenceLookup: [],
    });
    const model = parseM2File(source, 8051);
    expect(resolveSequence(model, 828)?.sequence.animationId).toBe(828);
    expect(resolveSequence(model, 999)).toBeNull();
  });

  it("follows alias chains (flag 0x40) to the data-owning variation", () => {
    const source = buildM2ModelFixture({
      sequences: [
        { animationId: 5, variationIndex: 0, flags: 0x40, aliasNext: 1 },
        { animationId: 5, variationIndex: 1, flags: 0x20 },
      ],
    });
    const model = parseM2File(source, 8052);
    const resolution = resolveSequence(model, 5);
    expect(resolution?.sequence.index).toBe(1);
    expect(resolution?.payload).toBe(model.payload);
  });

  it("rejects alias cycles visibly", () => {
    const source = buildM2ModelFixture({
      sequences: [
        { animationId: 5, flags: 0x40, aliasNext: 1 },
        { animationId: 5, flags: 0x40, aliasNext: 0 },
      ],
    });
    const model = parseM2File(source, 8053);
    expect(() => resolveSequence(model, 5)).toThrow(/FileDataID 8053.*alias.*cycle/i);
  });

  it("resolves sequences from a linked skeleton when the model has SKID", () => {
    const model = parseM2File(buildM2ModelFixture({
      skeletonFileDataId: 8060,
      sequences: [{ animationId: 0, flags: 0x20 }],
    }), 8059);
    const skeleton = parseSkelFile(buildSkelFixture({
      fileDataId: 8060,
      sequences: [{ animationId: 53, variationIndex: 0, flags: 0x20 }],
      bones: [{ parent: -1 }],
    }), 8060);

    const resolution = resolveSequence(model, 53, { skeleton });
    expect(resolution?.sequence.animationId).toBe(53);
    expect(resolution?.payload).toBe(skeleton.payload);
    expect(sampleBoneMatrices(model, resolution!, 0, skeleton)).toHaveLength(1);
  });
});

describe("animation data byte-owner selection", () => {
  const sequenceSpec = [{ animationId: 9, variationIndex: 0, flags: 0 }];

  function buildOwnerPair(inFile: boolean, animTranslation: [number, number, number]) {
    const modelSource = buildM2ModelFixture({
      sequences: inFile
        ? [{ animationId: 9, variationIndex: 0, flags: 0x20 }]
        : sequenceSpec,
      bones: [{
        translation: { sequences: [{ timestamps: [0], values: [[5, 5, 5]] }] },
      }],
      animationFiles: inFile ? [] : [{ animationId: 9, variationIndex: 0, fileDataId: 9001 }],
    });
    // A second model built with identical layout but different key values supplies
    // the external animation payload; its descriptor offsets match the first byte-for-byte.
    const animSource = buildM2ModelFixture({
      sequences: sequenceSpec,
      bones: [{
        translation: { sequences: [{ timestamps: [0], values: [animTranslation] }] },
      }],
    });
    return { modelSource, animSource };
  }

  it("reads in-file keys from the MD21 payload when flag 0x20 is set", () => {
    const { modelSource } = buildOwnerPair(true, [1, 0, 0]);
    const model = parseM2File(modelSource, 8054);
    const resolution = resolveSequence(model, 9)!;
    expect(resolution.animationFileDataId).toBeNull();
    const matrices = sampleBoneMatrices(model, resolution, 0);
    expect(matrices[0].slice(12, 15)).toEqual([5, 5, 5].map((value) => expect.closeTo(value, 4)));
  });

  it("reads external keys from the AFID animation payload, not the model bytes", () => {
    const { modelSource, animSource } = buildOwnerPair(false, [1, 0, 0]);
    const model = parseM2File(modelSource, 8055);
    const anim = parseAnimFileFromModelPayload(animSource);
    const resolution = resolveSequence(model, 9, { animFiles: new Map([[9001, anim]]) });
    expect(resolution?.animationFileDataId).toBe(9001);
    const matrices = sampleBoneMatrices(model, resolution!, 0);
    // The model payload carries decoy [5, 5, 5] at the same offsets; the anim wins.
    expect(matrices[0].slice(12, 15)).toEqual([1, 0, 0].map((value) => expect.closeTo(value, 4)));
  });

  it("returns a null payload for missing external animation files", () => {
    const { modelSource } = buildOwnerPair(false, [1, 0, 0]);
    const model = parseM2File(modelSource, 8056);
    const resolution = resolveSequence(model, 9);
    expect(resolution?.animationFileDataId).toBe(9001);
    expect(resolution?.payload).toBeNull();
    // Sampling degrades to the bind pose rather than failing.
    const matrices = sampleBoneMatrices(model, resolution!, 0);
    expect(matrices[0].slice(12, 15)).toEqual([0, 0, 0]);
  });
});

function parseAnimFileFromModelPayload(modelSource: ArrayBuffer): AnimFile {
  // The raw ANIM payload is the second fixture's MD21 payload bytes.
  const payload = md21PayloadOf(modelSource);
  const raw = payload.slice().buffer;
  return parseAnimFile(raw, 9001);
}

describe("track sampling", () => {
  function sampleTranslation(model: M2Model, animationId: number, timeMs: number) {
    const resolution = resolveSequence(model, animationId)!;
    return sampleBoneMatrices(model, resolution, timeMs)[0].slice(12, 15);
  }

  it("holds step keys and interpolates linear keys", () => {
    const step = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20, durationMs: 2000 }],
      bones: [{
        translation: {
          interpolation: 0,
          sequences: [{ timestamps: [0, 1000], values: [[10, 0, 0], [20, 0, 0]] }],
        },
      }],
    }), 8061);
    expect(sampleTranslation(step, 0, 999)[0]).toBeCloseTo(10, 5);
    expect(sampleTranslation(step, 0, 1000)[0]).toBeCloseTo(20, 5);
    expect(sampleTranslation(step, 0, 5000)[0]).toBeCloseTo(20, 5);

    const linear = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20, durationMs: 2000 }],
      bones: [{
        translation: {
          interpolation: 1,
          sequences: [{ timestamps: [0, 1000], values: [[10, 0, 0], [20, 0, 0]] }],
        },
      }],
    }), 8062);
    expect(sampleTranslation(linear, 0, 500)[0]).toBeCloseTo(15, 4);
  });

  it("slerps rotation keys through the shortest path", () => {
    const packedQuarterTurn = encodePackedQuaternion(0, 0, Math.SQRT1_2, Math.SQRT1_2);
    const packedIdentity = encodePackedQuaternion(0, 0, 0, 1);
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20, durationMs: 2000 }],
      bones: [{
        pivot: [0, 0, 0],
        rotation: {
          interpolation: 1,
          sequences: [{ timestamps: [0, 1000], values: [packedIdentity, packedQuarterTurn] }],
        },
      }],
    }), 8063);
    const half = sampleBoneMatrices(model, resolveSequence(model, 0)!, 500)[0];
    // Half of a 90-degree Z rotation moves +X to 45 degrees: x = y = sin(45).
    const image = applyMatrix(half, [1, 0, 0]);
    expect(image[0]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(image[1]).toBeCloseTo(Math.SQRT1_2, 3);
    expect(image[2]).toBeCloseTo(0, 6);
  });

  it("fails visibly when a sampled sequence has hermite or bezier keys", () => {
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20 }, { animationId: 1, flags: 0x20 }],
      bones: [{
        translation: {
          interpolation: 2,
          sequences: [
            undefined,
            { timestamps: [0], values: [[1, 2, 3]] },
          ],
        },
      }],
    }), 8064);

    // Slot 0 has no keys, so the unsupported mode is never consulted.
    expect(sampleTranslation(model, 0, 0)).toEqual([0, 0, 0]);
    expect(() => sampleTranslation(model, 1, 0)).toThrow(/interpolation mode 2 is not implemented/i);
  });

  it("wraps global-sequence tracks by the global loop duration", () => {
    const model = parseM2File(buildM2ModelFixture({
      globalSequences: [1000],
      sequences: [{ animationId: 0, flags: 0x20, durationMs: 5000 }],
      bones: [{
        translation: {
          interpolation: 1,
          globalSequence: 0,
          sequences: [{ timestamps: [0, 1000], values: [[0, 0, 0], [100, 0, 0]] }],
        },
      }],
    }), 8065);
    expect(sampleTranslation(model, 0, 1500)[0]).toBeCloseTo(50, 3);
    expect(sampleTranslation(model, 0, 2500)[0]).toBeCloseTo(50, 3);
    expect(sampleTranslation(model, 0, 2600)[0]).toBeCloseTo(60, 3);
  });
});

describe("bone matrix composition", () => {
  const pivot: [number, number, number] = [1, 0, 0];
  const quarterZ: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

  it("computes D = T(pivot + t) · R · S · T(-pivot)", () => {
    const local = composeBoneMatrix(null, pivot, [0.5, 0, 1], quarterZ, [2, 2, 2]);
    const image = applyMatrix(local, [2, 0, 0]);
    // q - pivot = [1,0,0]; scale -> [2,0,0]; rotate 90z -> [0,2,0]; +pivot+t -> [1.5, 2, 1].
    expect(image).toEqual([1.5, 2, 1].map((value) => expect.closeTo(value, 4)));
  });

  it("chains parent matrices through their children", () => {
    const root = composeBoneMatrix(null, pivot, [0.5, 0, 1], quarterZ, [2, 2, 2]);
    const childLocal = composeBoneMatrix(root, [9, 9, 9], [0, 0, 0], identityQuaternion, [1, 1, 1]);
    // With no keys the child local is the identity, so D_child = D_root.
    expect(applyMatrix(childLocal, [2, 0, 0])).toEqual(
      applyMatrix(root, [2, 0, 0]).map((value) => expect.closeTo(value, 4)),
    );

    const offsetChild = composeBoneMatrix(root, [9, 9, 9], [0, 1, 0], identityQuaternion, [1, 1, 1]);
    const image = applyMatrix(offsetChild, [2, 0, 0]);
    const expected = applyMatrix(root, [2, 1, 0]);
    expect(image).toEqual(expected.map((value) => expect.closeTo(value, 4)));
  });

  it("matches the composed matrices inside sampleBoneMatrices", () => {
    const packed = encodePackedQuaternion(...quarterZ);
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20 }],
      bones: [
        {
          pivot,
          translation: { sequences: [{ timestamps: [0], values: [[0.5, 0, 1]] }] },
          rotation: { sequences: [{ timestamps: [0], values: [packed] }] },
          scale: { sequences: [{ timestamps: [0], values: [[2, 2, 2]] }] },
        },
        { parent: 0, pivot: [9, 9, 9] },
      ],
    }), 8066);
    const matrices = sampleBoneMatrices(model, resolveSequence(model, 0)!, 0);
    const expected = composeBoneMatrix(null, pivot, [0.5, 0, 1], quarterZ, [2, 2, 2]);
    expect(matrices[0]).toEqual(expected.map((value) => expect.closeTo(value, 4)));
    expect(applyMatrix(matrices[1], [2, 0, 0])).toEqual(
      applyMatrix(expected, [2, 0, 0]).map((value) => expect.closeTo(value, 4)),
    );
  });
});

describe("attachment transforms", () => {
  it("computes bone matrix · T(position) by attachment id", () => {
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20 }],
      bones: [
        {},
        { translation: { sequences: [{ timestamps: [0], values: [[1, 0, 0]] }] } },
      ],
      attachments: [
        { id: 34, bone: 1, position: [0, 0.5, 1] },
        { id: 21, bone: 0, position: [2, 0, 0] },
      ],
    }), 8070);
    const matrices = sampleBoneMatrices(model, resolveSequence(model, 0)!, 0);

    const chest = attachmentMatrix(model, matrices, 34)!;
    expect(chest.slice(12, 15)).toEqual([1, 0.5, 1].map((value) => expect.closeTo(value, 4)));

    const hand = attachmentMatrix(model, matrices, 21)!;
    expect(hand.slice(12, 15)).toEqual([2, 0, 0].map((value) => expect.closeTo(value, 4)));

    expect(attachmentMatrix(model, matrices, 9999)).toBeNull();
  });

  it("resolves bind-pose attachments when the bone tracks have no keys", () => {
    const model = parseM2File(buildM2ModelFixture({
      sequences: [{ animationId: 0, flags: 0x20 }],
      bones: [{}],
      attachments: [{ id: 34, bone: 0, position: [1, 2, 3] }],
      attachmentLookup: [-1, -1, -1, 0],
    }), 8071);
    const matrices = sampleBoneMatrices(model, resolveSequence(model, 0)!, 0);
    expect(matrices).toHaveLength(1);
    const chest = attachmentMatrix(model, matrices, 34)!;
    expect(chest.slice(12, 15)).toEqual([1, 2, 3].map((value) => expect.closeTo(value, 4)));
  });
});

describe("computeSkinnedVertexBounds", () => {
  const model = parseM2File(buildM2ModelFixture({
    bones: [{}, {}],
    vertices: [
      { position: [0, 0, 0], boneWeights: [255, 0, 0, 0], boneIndices: [0, 0, 0, 0] },
      { position: [2, 0, 0], boneWeights: [128, 127, 0, 0], boneIndices: [0, 1, 0, 0] },
      { position: [0, 5, 0], boneWeights: [255, 0, 0, 0], boneIndices: [1, 0, 0, 0] },
    ],
  }), 8080);
  const skin = parseSkinFile(buildSkinFixture({
    vertexLookup: [0, 1, 2],
    indices: [0, 1, 0],
    bones: [[0, 0, 0, 0], [1, 0, 0, 0]],
    sections: [
      { meshPartId: 0, vertexStart: 0, vertexCount: 2, indexCount: 3 },
      { meshPartId: 508, vertexStart: 2, vertexCount: 1, indexCount: 0 },
    ],
    batches: [{}, { sectionIndex: 1 }],
  }), 8081);
  const includeVisible = (section: { meshPartId: number }) =>
    isGeosetVisibleByDefault(geosetIdFromMeshPartId(section.meshPartId));

  it("returns raw vertex bounds at bind pose over the included sections", () => {
    const bounds = computeSkinnedVertexBounds(model, skin, null, includeVisible);
    expect(bounds).toEqual({ min: [0, 0, 0], max: [2, 0, 0] });
  });

  it("blends bone matrices by normalized weights", () => {
    const bone0 = composeBoneMatrix(null, [0, 0, 0], [1, 0, 0], identityQuaternion, [1, 1, 1]);
    const bone1 = composeBoneMatrix(null, [0, 0, 0], [0, 0, 0], identityQuaternion, [1, 1, 1]);
    const bounds = computeSkinnedVertexBounds(model, skin, [bone0, bone1], includeVisible);
    expect(bounds!.min[0]).toBeCloseTo(1, 4);
    // Vertex 1 sits at x = 2: bone 0 shifts it to 3, bone 1 leaves it at 2.
    expect(bounds!.max[0]).toBeCloseTo((128 * 3 + 127 * 2) / 255, 4);
    expect(bounds!.max[1]).toBeCloseTo(0, 6);
  });

  it("returns null when no sections are included", () => {
    expect(computeSkinnedVertexBounds(model, skin, null, () => false)).toBeNull();
  });
});
