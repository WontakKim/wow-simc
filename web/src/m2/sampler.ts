// Pure animation sampling for parsed M2 models: sequence resolution (lookup,
// scan, alias chains, byte-owner selection), bone matrix composition, attachment
// transforms, UV texture-transform matrices, pose blending and skinned vertex
// bounds. Matrices are column-major number[16] in native M2 coordinates; scene
// conversion happens only via ./coordinates.

import { readTrackKeys } from "./model";
import type { M2Model, M2Sequence, M2Skin, M2Skel, Payload, Quaternion, TrackKeys, Vec3 } from "./model";

/** Quaternion decode convention (wow.export): (u - 32767) / 32768, then normalize. */
export function decodePackedQuaternion(packed: number[]): Quaternion {
  const x = (packed[0] - 32767) / 32768;
  const y = (packed[1] - 32767) / 32768;
  const z = (packed[2] - 32767) / 32768;
  const w = (packed[3] - 32767) / 32768;
  const norm = Math.hypot(x, y, z, w);
  if (norm === 0) return [0, 0, 0, 1];
  return [x / norm, y / norm, z / norm, w / norm];
}

function normalizeQuaternion(q: number[]): Quaternion {
  const norm = Math.hypot(q[0], q[1], q[2], q[3]);
  if (norm === 0) return [0, 0, 0, 1];
  return [q[0] / norm, q[1] / norm, q[2] / norm, q[3] / norm];
}

/** Spherical interpolation taking the shortest path (negating b when dot < 0). */
export function slerpQuaternion(a: Quaternion, b: Quaternion, t: number): Quaternion {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  let end: Quaternion = b;
  if (dot < 0) {
    end = [-b[0], -b[1], -b[2], -b[3]];
    dot = -dot;
  }
  if (dot > 0.9995) return normalizeQuaternion([
    a[0] + (end[0] - a[0]) * t,
    a[1] + (end[1] - a[1]) * t,
    a[2] + (end[2] - a[2]) * t,
    a[3] + (end[3] - a[3]) * t,
  ]);
  const theta = Math.acos(Math.min(1, dot));
  const sinTheta = Math.sin(theta);
  const weightA = Math.sin((1 - t) * theta) / sinTheta;
  const weightB = Math.sin(t * theta) / sinTheta;
  return normalizeQuaternion([
    a[0] * weightA + end[0] * weightB,
    a[1] * weightA + end[1] * weightB,
    a[2] * weightA + end[2] * weightB,
    a[3] * weightA + end[3] * weightB,
  ]);
}

/** Local bone transform D = T(pivot + t) · R(q) · S(s) · T(-pivot), chained onto the parent. */
export function composeBoneMatrix(
  parent: number[] | null,
  pivot: Vec3,
  translation: Vec3,
  rotation: Quaternion,
  scale: Vec3,
): number[] {
  // Rotation columns scaled by the scale components (S applies before R).
  const [x, y, z, w] = rotation;
  const rs = [
    (1 - 2 * (y * y + z * z)) * scale[0], 2 * (x * y + w * z) * scale[0], 2 * (x * z - w * y) * scale[0],
    2 * (x * y - w * z) * scale[1], (1 - 2 * (x * x + z * z)) * scale[1], 2 * (y * z + w * x) * scale[1],
    2 * (x * z + w * y) * scale[2], 2 * (y * z - w * x) * scale[2], (1 - 2 * (x * x + y * y)) * scale[2],
  ];
  const local = [
    rs[0], rs[1], rs[2], 0,
    rs[3], rs[4], rs[5], 0,
    rs[6], rs[7], rs[8], 0,
    pivot[0] + translation[0] - (rs[0] * pivot[0] + rs[3] * pivot[1] + rs[6] * pivot[2]),
    pivot[1] + translation[1] - (rs[1] * pivot[0] + rs[4] * pivot[1] + rs[7] * pivot[2]),
    pivot[2] + translation[2] - (rs[2] * pivot[0] + rs[5] * pivot[1] + rs[8] * pivot[2]),
    1,
  ];
  if (!parent) return local;
  return multiplyMatrices(parent, local);
}

export function multiplyMatrices(a: number[], b: number[]): number[] {
  const out = new Array<number>(16);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        a[row] * b[column * 4] + a[4 + row] * b[column * 4 + 1]
        + a[8 + row] * b[column * 4 + 2] + a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

export interface SequenceResolution {
  sequence: M2Sequence;
  /** Null when the owning bytes are unavailable (missing external .anim). */
  payload: Payload | null;
  /** FileDataID of the external .anim owning the bytes, null for in-file data. */
  animationFileDataId: number | null;
}

export interface ResolveSequenceOptions {
  variationIndex?: number;
  animFiles?: Map<number, { payload: Payload }>;
  /** Linked SKEL; when present it owns the sequences, lookup, AFID and track bytes. */
  skeleton?: M2Skel;
}

export function findSequences(source: M2Model | M2Skel, animationId: number): M2Sequence[] {
  return source.sequences.filter((sequence) => sequence.animationId === animationId);
}

function findVariation(sequences: M2Sequence[], animationId: number, variationIndex: number | undefined): M2Sequence | undefined {
  if (variationIndex !== undefined) {
    return sequences.find((sequence) => sequence.animationId === animationId && sequence.variationIndex === variationIndex);
  }
  return sequences.find((sequence) => sequence.animationId === animationId);
}

export function resolveSequence(model: M2Model, animationId: number, options: ResolveSequenceOptions = {}): SequenceResolution | null {
  const skeleton = options.skeleton;
  const sequences = skeleton ? skeleton.sequences : model.sequences;
  const lookup = skeleton ? skeleton.sequenceLookup : model.sequenceLookup;
  const references = skeleton ? skeleton.animationFileReferences : model.animationFileReferences;
  const basePayload = skeleton ? skeleton.payload : model.payload;
  const label = `FileDataID ${skeleton ? skeleton.fileDataId : model.fileDataId}`;

  let sequence: M2Sequence | undefined;
  if (options.variationIndex === undefined && animationId >= 0 && animationId < lookup.length && lookup[animationId] >= 0) {
    sequence = sequences[lookup[animationId]];
  }
  if (!sequence) sequence = findVariation(sequences, animationId, options.variationIndex);
  if (!sequence) return null;

  let current: M2Sequence = sequence;
  const visited = new Set<number>();
  while (current.flags & 0x40) {
    if (visited.has(current.index)) {
      throw new Error(`${label}: sequence alias chain entered a cycle at index ${current.index}.`);
    }
    visited.add(current.index);
    const next = sequences[current.aliasNext];
    if (!next) throw new Error(`${label}: sequence ${current.index} aliases missing sequence ${current.aliasNext}.`);
    current = next;
  }
  sequence = current;

  if (sequence.flags & 0x20) {
    return { sequence, payload: basePayload, animationFileDataId: null };
  }
  const reference = references.find(
    (entry) => entry.animationId === sequence.animationId && entry.variationIndex === sequence.variationIndex,
  );
  const fileDataId = reference && reference.fileDataId !== 0 ? reference.fileDataId : null;
  const animFile = fileDataId !== null ? options.animFiles?.get(fileDataId) : undefined;
  return { sequence, payload: animFile ? animFile.payload : null, animationFileDataId: fileDataId };
}

const IDENTITY_TRANSLATION: Vec3 = [0, 0, 0];
const IDENTITY_ROTATION: Quaternion = [0, 0, 0, 1];
const IDENTITY_SCALE: Vec3 = [1, 1, 1];

function sampleFloatComponents(keys: TrackKeys, timeMs: number): number[] | null {
  if (keys.timestamps.length === 0) return null;
  const last = keys.timestamps.length - 1;
  if (timeMs <= keys.timestamps[0]) return keys.values[0];
  if (timeMs >= keys.timestamps[last]) return keys.values[last];
  let index = 0;
  while (index < last - 1 && keys.timestamps[index + 1] <= timeMs) index += 1;
  const span = keys.timestamps[index + 1] - keys.timestamps[index];
  const t = span > 0 ? (timeMs - keys.timestamps[index]) / span : 0;
  if (keys.interpolationMode === 0) return keys.values[index];
  return keys.values[index].map((value, component) => value + (keys.values[index + 1][component] - value) * t);
}

function sampleQuaternionKeys(keys: TrackKeys, timeMs: number): Quaternion | null {
  if (keys.timestamps.length === 0) return null;
  const last = keys.timestamps.length - 1;
  if (timeMs <= keys.timestamps[0]) return decodePackedQuaternion(keys.values[0]);
  if (timeMs >= keys.timestamps[last]) return decodePackedQuaternion(keys.values[last]);
  let index = 0;
  while (index < last - 1 && keys.timestamps[index + 1] <= timeMs) index += 1;
  if (keys.interpolationMode === 0) return decodePackedQuaternion(keys.values[index]);
  const span = keys.timestamps[index + 1] - keys.timestamps[index];
  const t = span > 0 ? (timeMs - keys.timestamps[index]) / span : 0;
  return slerpQuaternion(decodePackedQuaternion(keys.values[index]), decodePackedQuaternion(keys.values[index + 1]), t);
}

/**
 * Bone deformation matrices for every bone at a time inside the resolved
 * sequence, in native model coordinates. No inverse bind matrices: vertices are
 * stored in model space and blended directly against these matrices.
 */
export function sampleBoneMatrices(
  model: M2Model,
  resolution: SequenceResolution,
  timeMs: number,
  skeleton?: M2Skel,
): number[][] {
  const bones = skeleton ? skeleton.bones : model.bones;
  const globalDurations = skeleton ? skeleton.globalSequenceDurationsMs : model.globalSequenceDurationsMs;
  const payload = resolution.payload;
  const matrices: Array<number[] | undefined> = new Array(bones.length);

  const matrixOf = (index: number): number[] => {
    const cached = matrices[index];
    if (cached) return cached;
    const bone = bones[index];
    let translation = IDENTITY_TRANSLATION;
    let rotation = IDENTITY_ROTATION;
    let scale = IDENTITY_SCALE;
    if (payload) {
      const trackTime = (track: { globalSequence: number }): number => {
        if (track.globalSequence < 0) return timeMs;
        const duration = globalDurations[track.globalSequence];
        return duration > 0 ? timeMs % duration : timeMs;
      };
      const sampled = sampleFloatComponents(readTrackKeys(payload, bone.translation, resolution.sequence.index), trackTime(bone.translation));
      if (sampled) translation = [sampled[0], sampled[1], sampled[2]];
      const sampledRotation = sampleQuaternionKeys(readTrackKeys(payload, bone.rotation, resolution.sequence.index), trackTime(bone.rotation));
      if (sampledRotation) rotation = sampledRotation;
      const sampledScale = sampleFloatComponents(readTrackKeys(payload, bone.scale, resolution.sequence.index), trackTime(bone.scale));
      if (sampledScale) scale = [sampledScale[0], sampledScale[1], sampledScale[2]];
    }
    const parent = bone.parentIndex >= 0 ? matrixOf(bone.parentIndex) : null;
    const matrix = composeBoneMatrix(parent, bone.pivot, translation, rotation, scale);
    matrices[index] = matrix;
    return matrix;
  };

  for (let index = 0; index < bones.length; index += 1) matrixOf(index);
  return matrices as number[][];
}

export interface M2ColorSample {
  rgb: [number, number, number];
  alpha: number;
}

function trackTimeMs(track: { globalSequence: number }, timeMs: number, globalDurations: number[]): number {
  if (track.globalSequence < 0) return timeMs;
  const duration = globalDurations[track.globalSequence];
  return duration > 0 ? timeMs % duration : timeMs;
}

/**
 * Batch color slot at a time inside the sequence. Color rgb defaults to white
 * and alpha to the 32767/32768 convention when the track is empty or the
 * sequence bytes are unavailable.
 */
export function sampleM2Color(
  model: M2Model,
  resolution: SequenceResolution,
  colorIndex: number,
  timeMs: number,
): M2ColorSample | null {
  const color = model.colors[colorIndex];
  if (!color) return null;
  const sequenceIndex = resolution.sequence.index;
  const sampledRgb = resolution.payload
    ? sampleFloatComponents(readTrackKeys(resolution.payload, color.color, sequenceIndex), trackTimeMs(color.color, timeMs, model.globalSequenceDurationsMs))
    : null;
  const sampledAlpha = resolution.payload
    ? sampleFloatComponents(readTrackKeys(resolution.payload, color.alpha, sequenceIndex), trackTimeMs(color.alpha, timeMs, model.globalSequenceDurationsMs))
    : null;
  return {
    rgb: sampledRgb ? [sampledRgb[0], sampledRgb[1], sampledRgb[2]] : [1, 1, 1],
    alpha: sampledAlpha ? sampledAlpha[0] / 32768 : 32767 / 32768,
  };
}

/**
 * Texture weight slot at a time inside the sequence: u_tex_sample_alpha
 * components, defaulting to 32767/32768 when empty.
 */
export function sampleM2TextureWeight(
  model: M2Model,
  resolution: SequenceResolution,
  weightIndex: number,
  timeMs: number,
): number {
  const track = model.textureWeights[weightIndex];
  if (!track) return 32767 / 32768;
  const sampled = resolution.payload
    ? sampleFloatComponents(readTrackKeys(resolution.payload, track, resolution.sequence.index), trackTimeMs(track, timeMs, model.globalSequenceDurationsMs))
    : null;
  return sampled ? sampled[0] / 32768 : 32767 / 32768;
}

/**
 * Linear per-element blend of two full bone-matrix poses. Short cross-fade
 * windows (the replay 0.15 s transition) keep linear matrix interpolation
 * visually equivalent to slerping local transforms.
 */
export function blendBoneMatrices(a: number[][], b: number[][], weight: number): number[][] {
  if (a.length !== b.length) {
    throw new Error(`Cannot blend poses of ${a.length} and ${b.length} bones.`);
  }
  const clamped = Math.max(0, Math.min(1, weight));
  return a.map((matrix, index) => matrix.map((value, element) =>
    value + (b[index][element] - value) * clamped));
}

/**
 * UV transform matrix for one texture-transform slot at a time inside the
 * sequence, in the exporter convention
 * M = [T(c) R T(-c)] * [T(c) S T(-c)] * T(t) with c = (0.5, 0.5, 0):
 * translation is applied first, then the centered scale, then the centered
 * rotation (wow.export M2RendererGL._update_tex_matrices). Returns identity
 * when the slot index is -1/undefined or carries no tracks.
 */
export function sampleTextureTransformMatrix(
  model: M2Model,
  resolution: SequenceResolution,
  transformIndex: number,
  timeMs: number,
): number[] {
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  if (transformIndex < 0 || transformIndex >= model.textureTransforms.length || !resolution.payload) {
    return identity;
  }
  const transform = model.textureTransforms[transformIndex];
  const sequenceIndex = resolution.sequence.index;

  const translation = sampleFloatComponents(readTrackKeys(resolution.payload, transform.translation, sequenceIndex), timeMs);
  const rotation = sampleQuaternionKeys(readTrackKeys(resolution.payload, transform.rotation, sequenceIndex), timeMs);
  const scale = sampleFloatComponents(readTrackKeys(resolution.payload, transform.scale, sequenceIndex), timeMs);

  // Column-major composition matching the exporter product
  // [T(c) R T(-c)] * [T(c) S T(-c)] * T(t), c = (0.5, 0.5, 0): each block is
  // appended on the right, so translation applies first in UV space, then the
  // centered scale, then the centered rotation.
  const matrix = identity.slice();
  const appendCentered = (linear: number[]) => {
    const centered = [
      linear[0], linear[1], linear[2], 0,
      linear[3], linear[4], linear[5], 0,
      linear[6], linear[7], linear[8], 0,
      0.5 - (linear[0] * 0.5 + linear[3] * 0.5), 0.5 - (linear[1] * 0.5 + linear[4] * 0.5), 0, 1,
    ];
    matrix.splice(0, matrix.length, ...multiplyMatrices(matrix, centered));
  };

  if (rotation) {
    const [x, y, z, w] = rotation;
    appendCentered([
      1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y),
      2 * (x * y - w * z), 1 - 2 * (x * x + z * z), 2 * (y * z + w * x),
      2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y),
    ]);
  }
  if (scale) {
    appendCentered([scale[0], 0, 0, 0, scale[1], 0, 0, 0, scale[2]]);
  }
  if (translation) {
    matrix.splice(0, matrix.length, ...multiplyMatrices(matrix, [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation[0], translation[1], 0, 1,
    ]));
  }
  return matrix;
}

/** Attachment world transform: the bone matrix followed by T(position). */
export function attachmentMatrix(model: M2Model, matrices: number[][], attachmentId: number): number[] | null {
  const attachment = model.attachments.find((entry) => entry.id === attachmentId);
  if (!attachment || attachment.boneIndex >= matrices.length) return null;
  const bone = matrices[attachment.boneIndex];
  const [px, py, pz] = attachment.position;
  return [
    bone[0], bone[1], bone[2], bone[3],
    bone[4], bone[5], bone[6], bone[7],
    bone[8], bone[9], bone[10], bone[11],
    bone[12] + bone[0] * px + bone[4] * py + bone[8] * pz,
    bone[13] + bone[1] * px + bone[5] * py + bone[9] * pz,
    bone[14] + bone[2] * px + bone[6] * py + bone[10] * pz,
    1,
  ];
}

/**
 * Axis-aligned bounds over the vertices of the included skin sections, blended
 * against the bone matrices with normalized (w / 255) weights. Pass null
 * matrices for the bind pose (bounds then equal the raw vertex bounds).
 */
export function computeSkinnedVertexBounds(
  model: M2Model,
  skin: M2Skin,
  boneMatrices: number[][] | null,
  includeSection: (section: { meshPartId: number }) => boolean,
): { min: Vec3; max: Vec3 } | null {
  let min: Vec3 | null = null;
  let max: Vec3 | null = null;
  const accumulate = (point: Vec3) => {
    if (!min || !max) {
      min = [point[0], point[1], point[2]];
      max = [point[0], point[1], point[2]];
      return;
    }
    for (let axis = 0; axis < 3; axis += 1) {
      if (point[axis] < min[axis]) min[axis] = point[axis];
      if (point[axis] > max[axis]) max[axis] = point[axis];
    }
  };

  for (const section of skin.sections) {
    if (!includeSection(section)) continue;
    for (let slot = section.vertexStart; slot < section.vertexStart + section.vertexCount; slot += 1) {
      const vertex = model.vertices[skin.vertexLookup[slot]];
      if (!boneMatrices) {
        accumulate(vertex.position);
        continue;
      }
      const [px, py, pz] = vertex.position;
      const blended: Vec3 = [0, 0, 0];
      for (let influence = 0; influence < 4; influence += 1) {
        const weight = vertex.boneWeights[influence];
        if (weight === 0) continue;
        const matrix = boneMatrices[vertex.boneIndices[influence]];
        const factor = weight / 255;
        blended[0] += factor * (matrix[0] * px + matrix[4] * py + matrix[8] * pz + matrix[12]);
        blended[1] += factor * (matrix[1] * px + matrix[5] * py + matrix[9] * pz + matrix[13]);
        blended[2] += factor * (matrix[2] * px + matrix[6] * py + matrix[10] * pz + matrix[14]);
      }
      accumulate(blended);
    }
  }
  return min && max ? { min, max } : null;
}
