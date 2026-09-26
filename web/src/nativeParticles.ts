import type {
  NativeBone,
  NativeParticleEmitter,
  NativeRibbonEmitter,
  NativeMeshVertex,
  NativeParticleTrack,
  NativeTrack,
  QuaternionTuple,
  Vector2Tuple,
  Vector3Tuple,
} from "./nativeM2";

/**
 * Column-major 4x4 matrix in native (Z-up) effect space, matching the layout
 * produced by the native attachment sampler in web/src/m2.
 */
export type NativeMatrix = number[];

export interface NativeParticleSample {
  spawnIndex: number;
  age: number;
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  color: Vector3Tuple;
  alpha: number;
  alphaCutoff: number;
  size: Vector2Tuple;
  rotation: number;
  uvFrame: number;
  /** Tail-cell flipbook index used by tail quads (flag 0x40000). */
  tailUvFrame: number;
  /** Secondary and tertiary UV scroll offsets, present only for multi-texture emitters. */
  uvScrollOffsets?: [Vector2Tuple, Vector2Tuple];
}

export interface NativeRibbonEdgeSample {
  /** Newest edge first; ages grow towards the end of the list. */
  age: number;
  above: Vector3Tuple;
  below: Vector3Tuple;
  color: Vector3Tuple;
  alpha: number;
  u: number;
  v: number;
}

export interface NativeEmitterSampleOptions {
  emissionEndSeconds?: number;
  modelScale?: number;
  /**
   * Full source transform (position, rotation and scale) in effect space at a
   * past time. World-space particles freeze the birth-time transform; local
   * (flag 0x10) particles follow the current one.
   */
  sourceTransformAtTime?: (timeSeconds: number) => NativeMatrix;
  /**
   * Occurrence identity: repeated casts of the same effect key their random
   * streams with this seed so they no longer look identical.
   */
  occurrenceSeed?: string;
  globalSequenceDurationsMs?: number[];
  bones?: NativeBone[];
  sequenceIndex?: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function slerpQuaternion(first: QuaternionTuple, second: QuaternionTuple, ratio: number): QuaternionTuple {
  const start = normalizeQuaternion(first);
  const target = normalizeQuaternion(second);
  const dot = start[0] * target[0] + start[1] * target[1] + start[2] * target[2] + start[3] * target[3];
  // q and -q describe the same rotation; flip the target so the arc stays shortest.
  const end = dot < 0 ? [-target[0], -target[1], -target[2], -target[3]] as QuaternionTuple : target;
  const alignedDot = Math.abs(dot);
  if (alignedDot > 0.9995) {
    return normalizeQuaternion([
      start[0] + (end[0] - start[0]) * ratio,
      start[1] + (end[1] - start[1]) * ratio,
      start[2] + (end[2] - start[2]) * ratio,
      start[3] + (end[3] - start[3]) * ratio,
    ]);
  }
  const theta = Math.acos(clamp(alignedDot, -1, 1));
  const sine = Math.sin(theta);
  const startWeight = Math.sin((1 - ratio) * theta) / sine;
  const endWeight = Math.sin(ratio * theta) / sine;
  return normalizeQuaternion([
    start[0] * startWeight + end[0] * endWeight,
    start[1] * startWeight + end[1] * endWeight,
    start[2] * startWeight + end[2] * endWeight,
    start[3] * startWeight + end[3] * endWeight,
  ]);
}

function interpolateValue<T>(first: T, second: T, ratio: number): T {
  if (typeof first === "number" && typeof second === "number") {
    return (first + (second - first) * ratio) as T;
  }
  if (Array.isArray(first) && Array.isArray(second)) {
    // Four-component track values are rotations, which interpolate on the unit sphere.
    if (first.length === 4 && second.length === 4) {
      return slerpQuaternion(first as QuaternionTuple, second as QuaternionTuple, ratio) as T;
    }
    return first.map((component, index) => component + (second[index] - component) * ratio) as T;
  }
  return first;
}

function sampleKeys<T>(timestamps: number[], values: T[], time: number, interpolation: 0 | 1, fallback: T): T {
  if (timestamps.length === 0 || values.length === 0) return fallback;
  if (timestamps.length === 1 || time <= timestamps[0]) return values[0];
  for (let index = 1; index < timestamps.length; index += 1) {
    if (time > timestamps[index]) continue;
    if (time === timestamps[index]) return values[index];
    if (interpolation === 0) return values[index - 1];
    const duration = timestamps[index] - timestamps[index - 1];
    const ratio = duration <= 0 ? 0 : (time - timestamps[index - 1]) / duration;
    return interpolateValue(values[index - 1], values[index], ratio);
  }
  return values.at(-1) ?? fallback;
}

export function sampleNativeTrack<T>(
  track: NativeTrack<T>,
  timeMs: number,
  sequenceDurationMs: number,
  fallback: T,
  globalSequenceDurationsMs: number[] = [],
  sequenceIndex = 0,
): T {
  const sequence = track.sequences[track.globalSequence >= 0 || track.sequences.length === 1 ? 0 : sequenceIndex];
  if (!sequence) return fallback;
  const duration = track.globalSequence >= 0
    ? globalSequenceDurationsMs[track.globalSequence]
    : sequenceDurationMs;
  if (duration === undefined) {
    throw new Error(`Global sequence ${track.globalSequence} has no duration.`);
  }
  if (duration === 0 && sequence.values.length > 1) {
    throw new Error(`Global sequence ${track.globalSequence} has zero duration and multiple keys.`);
  }
  const wrappedTime = duration > 0 ? ((timeMs % duration) + duration) % duration : 0;
  return sampleKeys(sequence.timestamps, sequence.values, wrappedTime, track.interpolation, fallback);
}


export function sampleNativeParticleTrack<T>(
  track: NativeParticleTrack<T>,
  lifetimeProgress: number,
  fallback: T,
): T {
  return sampleKeys(
    track.timestamps,
    track.values,
    clamp(lifetimeProgress, 0, 1) * 32767,
    1,
    fallback,
  );
}

function add(first: Vector3Tuple, second: Vector3Tuple): Vector3Tuple {
  return [first[0] + second[0], first[1] + second[1], first[2] + second[2]];
}

function scale(value: Vector3Tuple, factor: number): Vector3Tuple {
  return [value[0] * factor, value[1] * factor, value[2] * factor];
}

function normalize(value: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(...value);
  return length > 0 ? scale(value, 1 / length) : [0, 0, 1];
}

function normalizeQuaternion(value: QuaternionTuple): QuaternionTuple {
  const length = Math.hypot(...value);
  return length > 0
    ? [value[0] / length, value[1] / length, value[2] / length, value[3] / length]
    : [0, 0, 0, 1];
}

function rotateVector(value: Vector3Tuple, quaternionValue: QuaternionTuple): Vector3Tuple {
  const [x, y, z, w] = normalizeQuaternion(quaternionValue);
  const [vx, vy, vz] = value;
  const crossX = y * vz - z * vy;
  const crossY = z * vx - x * vz;
  const crossZ = x * vy - y * vx;
  const secondCrossX = y * crossZ - z * crossY;
  const secondCrossY = z * crossX - x * crossZ;
  const secondCrossZ = x * crossY - y * crossX;
  return [
    vx + 2 * (w * crossX + secondCrossX),
    vy + 2 * (w * crossY + secondCrossY),
    vz + 2 * (w * crossZ + secondCrossZ),
  ];
}

export function applyBonePoint(
  point: Vector3Tuple,
  bone: NativeBone | undefined,
  timeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[] = [],
  bones?: NativeBone[],
  sequenceIndex = 0,
): Vector3Tuple {
  if (!bone) return point;
  const translation = sampleNativeTrack<Vector3Tuple>(bone.translation, timeMs, sequenceDurationMs, [0, 0, 0], globalSequenceDurationsMs, sequenceIndex);
  const rotation = sampleNativeTrack<QuaternionTuple>(bone.rotation, timeMs, sequenceDurationMs, [0, 0, 0, 1], globalSequenceDurationsMs, sequenceIndex);
  const boneScale = sampleNativeTrack<Vector3Tuple>(bone.scale, timeMs, sequenceDurationMs, [1, 1, 1], globalSequenceDurationsMs, sequenceIndex);
  const pivotRelative: Vector3Tuple = [
    (point[0] - bone.pivot[0]) * boneScale[0],
    (point[1] - bone.pivot[1]) * boneScale[1],
    (point[2] - bone.pivot[2]) * boneScale[2],
  ];
  const transformed = add(add(rotateVector(pivotRelative, rotation), bone.pivot), translation);
  return bone.parentIndex >= 0 && bones
    ? applyBonePoint(transformed, bones[bone.parentIndex], timeMs, sequenceDurationMs, globalSequenceDurationsMs, bones, sequenceIndex)
    : transformed;
}

export function sampleNativeSkinnedVertex(
  vertex: NativeMeshVertex,
  bones: NativeBone[],
  timeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[] = [],
  sequenceIndex = 0,
): Vector3Tuple {
  let point: Vector3Tuple = [0, 0, 0];
  const weightTotal = vertex.boneWeights.reduce((total, weight) => total + weight, 0);
  if (weightTotal !== 255) throw new Error(`Vertex bone weights sum to ${weightTotal}, expected 255.`);
  for (let index = 0; index < 4; index += 1) {
    const weight = vertex.boneWeights[index];
    if (weight === 0) continue;
    const bone = bones[vertex.boneIndices[index]];
    if (!bone) throw new Error(`Vertex bone index ${vertex.boneIndices[index]} is outside the model.`);
    point = add(point, scale(applyBonePoint(vertex.position, bone, timeMs, sequenceDurationMs, globalSequenceDurationsMs, bones, sequenceIndex), weight / 255));
  }
  return point;
}

export function sampleNativeSkinnedNormal(
  vertex: NativeMeshVertex,
  bones: NativeBone[],
  timeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[] = [],
  sequenceIndex = 0,
): Vector3Tuple {
  let direction: Vector3Tuple = [0, 0, 0];
  for (let index = 0; index < 4; index += 1) {
    const weight = vertex.boneWeights[index];
    if (weight === 0) continue;
    const bone = bones[vertex.boneIndices[index]];
    if (!bone) throw new Error(`Vertex bone index ${vertex.boneIndices[index]} is outside the model.`);
    direction = add(direction, scale(applyBoneDirection(vertex.normal, bone, timeMs, sequenceDurationMs, globalSequenceDurationsMs, bones, sequenceIndex), weight / 255));
  }
  return normalize(direction);
}

function applyBoneDirection(
  direction: Vector3Tuple,
  bone: NativeBone | undefined,
  timeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[] = [],
  bones?: NativeBone[],
  sequenceIndex = 0,
): Vector3Tuple {
  if (!bone) return normalize(direction);
  const rotation = sampleNativeTrack<QuaternionTuple>(bone.rotation, timeMs, sequenceDurationMs, [0, 0, 0, 1], globalSequenceDurationsMs, sequenceIndex);
  const boneScale = sampleNativeTrack<Vector3Tuple>(bone.scale, timeMs, sequenceDurationMs, [1, 1, 1], globalSequenceDurationsMs, sequenceIndex);
  const transformed = normalize(rotateVector([
    direction[0] * boneScale[0],
    direction[1] * boneScale[1],
    direction[2] * boneScale[2],
  ], rotation));
  return bone.parentIndex >= 0 && bones
    ? applyBoneDirection(transformed, bones[bone.parentIndex], timeMs, sequenceDurationMs, globalSequenceDurationsMs, bones, sequenceIndex)
    : transformed;
}

function getConstantTrackValue(track: NativeTrack<number>) {
  const values = track.sequences.flatMap((sequence) => sequence.values);
  if (values.length === 0) return null;
  return values.every((value) => Math.abs(value - values[0]) < 0.000001) ? values[0] : null;
}

// ---------------------------------------------------------------------------
// Deterministic random streams.
// ---------------------------------------------------------------------------

/**
 * Counter-based RNG keyed by occurrence seed, emitter, spawn ordinal and
 * channel. Sampling is a pure function of those keys, so seeking backwards
 * reproduces earlier frames exactly and repeated casts (distinct occurrence
 * seeds) no longer share one stream.
 */
function hashOccurrenceSeed(text: string) {
  // FNV-1a over the occurrence key.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function randomUnit(occurrenceSeed: number, emitterIndex: number, spawnIndex: number, channel: number) {
  let value = occurrenceSeed
    ^ Math.imul(emitterIndex + 1, 0x9e3779b1)
    ^ Math.imul(spawnIndex + 1, 0x85ebca6b)
    ^ Math.imul(channel + 1, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
}

/** Reference Uniform(): uniform in [-1, 1). */
function randomSigned(occurrenceSeed: number, emitterIndex: number, spawnIndex: number, channel: number) {
  return randomUnit(occurrenceSeed, emitterIndex, spawnIndex, channel) * 2 - 1;
}

// Draw-channel allocation; stable numbering keeps sampled values independent
// of code paths taken.
const CHANNEL_RATE = 1;
const CHANNEL_LIFESPAN = 2;
const CHANNEL_SPHERE_RADIUS = 3;
const CHANNEL_SPHERE_POLAR = 4;
const CHANNEL_PLANE_X = 3;
const CHANNEL_PLANE_Y = 4;
const CHANNEL_PLANE_POLAR = 4;
const CHANNEL_PLANE_AZIMUTH = 6;
const CHANNEL_SPEED = 5;
const CHANNEL_SPHERE_AZIMUTH = 7;
const CHANNEL_SCALE_X = 7;
const CHANNEL_SCALE_Y = 8;
const CHANNEL_BASE_SPIN = 9;
const CHANNEL_SPIN_SPEED = 10;
const CHANNEL_RANDOM_CELL = 11;
const CHANNEL_BURST_SPEED = 13;
const CHANNEL_TEXTURE_OFFSET = 90;
const MULTITEX_BASE_CHANNEL = 20;

/**
 * The reference indexes a 128-entry table initialized from std::rand for
 * twinkle suppression and size weighting; those values are not recoverable
 * from the client. This deterministic stand-in keeps the table semantics
 * (index from age, threshold compare, always-on weight) with reproducible
 * values.
 */
const TWINKLE_TABLE = Array.from({ length: 128 }, (_, index) => randomUnit(0x7477696e, 0, 0, index));

// ---------------------------------------------------------------------------
// Matrix helpers (native Z-up effect space).
// ---------------------------------------------------------------------------

const IDENTITY_MATRIX: NativeMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

function multiplyMatrices(first: NativeMatrix, second: NativeMatrix): NativeMatrix {
  const result = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        first[row] * second[column * 4]
        + first[4 + row] * second[column * 4 + 1]
        + first[8 + row] * second[column * 4 + 2]
        + first[12 + row] * second[column * 4 + 3];
    }
  }
  return result;
}

function translationMatrix(translation: Vector3Tuple): NativeMatrix {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, translation[0], translation[1], translation[2], 1];
}

function transformMatrixPoint(matrix: NativeMatrix, point: Vector3Tuple): Vector3Tuple {
  return [
    matrix[0] * point[0] + matrix[4] * point[1] + matrix[8] * point[2] + matrix[12],
    matrix[1] * point[0] + matrix[5] * point[1] + matrix[9] * point[2] + matrix[13],
    matrix[2] * point[0] + matrix[6] * point[1] + matrix[10] * point[2] + matrix[14],
  ];
}

function scaleAroundSource(point: Vector3Tuple, source: NativeMatrix, factor: number): Vector3Tuple {
  return [
    source[12] + (point[0] - source[12]) * factor,
    source[13] + (point[1] - source[13]) * factor,
    source[14] + (point[2] - source[14]) * factor,
  ];
}

function transformMatrixDirection(matrix: NativeMatrix, direction: Vector3Tuple): Vector3Tuple {
  return [
    matrix[0] * direction[0] + matrix[4] * direction[1] + matrix[8] * direction[2],
    matrix[1] * direction[0] + matrix[5] * direction[1] + matrix[9] * direction[2],
    matrix[2] * direction[0] + matrix[6] * direction[1] + matrix[10] * direction[2],
  ];
}

function inverseMatrixDirection(matrix: NativeMatrix, direction: Vector3Tuple): Vector3Tuple {
  const [a, b, c, d, e, f, g, h, i] = [
    matrix[0], matrix[4], matrix[8], matrix[1], matrix[5], matrix[9], matrix[2], matrix[6], matrix[10],
  ];
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(determinant) < 1e-10) throw new Error("Burst velocity requires an invertible emitter transform.");
  return [
    ((e * i - f * h) * direction[0] + (c * h - b * i) * direction[1] + (b * f - c * e) * direction[2]) / determinant,
    ((f * g - d * i) * direction[0] + (a * i - c * g) * direction[1] + (c * d - a * f) * direction[2]) / determinant,
    ((d * h - e * g) * direction[0] + (b * g - a * h) * direction[1] + (a * e - b * d) * direction[2]) / determinant,
  ];
}

/** Bone transform at a time: T(pivot + translation) * R * S * T(-pivot), composed with the parent bone. */
function boneMatrixAt(
  bone: NativeBone | undefined,
  bones: NativeBone[] | undefined,
  timeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[],
  sequenceIndex: number,
): NativeMatrix {
  if (!bone) return IDENTITY_MATRIX;
  const translation = sampleNativeTrack<Vector3Tuple>(bone.translation, timeMs, sequenceDurationMs, [0, 0, 0], globalSequenceDurationsMs, sequenceIndex);
  const rotation = sampleNativeTrack<QuaternionTuple>(bone.rotation, timeMs, sequenceDurationMs, [0, 0, 0, 1], globalSequenceDurationsMs, sequenceIndex);
  const boneScale = sampleNativeTrack<Vector3Tuple>(bone.scale, timeMs, sequenceDurationMs, [1, 1, 1], globalSequenceDurationsMs, sequenceIndex);
  const [x, y, z, w] = normalizeQuaternion(rotation);
  // Rotation columns scaled per axis = R * S.
  const linear = [
    (1 - 2 * (y * y + z * z)) * boneScale[0], 2 * (x * y + w * z) * boneScale[0], 2 * (x * z - w * y) * boneScale[0],
    2 * (x * y - w * z) * boneScale[1], (1 - 2 * (x * x + z * z)) * boneScale[1], 2 * (y * z + w * x) * boneScale[1],
    2 * (x * z + w * y) * boneScale[2], 2 * (y * z - w * x) * boneScale[2], (1 - 2 * (x * x + y * y)) * boneScale[2],
  ];
  const pivotTranslation: Vector3Tuple = [
    linear[0] * -bone.pivot[0] + linear[3] * -bone.pivot[1] + linear[6] * -bone.pivot[2],
    linear[1] * -bone.pivot[0] + linear[4] * -bone.pivot[1] + linear[7] * -bone.pivot[2],
    linear[2] * -bone.pivot[0] + linear[5] * -bone.pivot[1] + linear[8] * -bone.pivot[2],
  ];
  const local: NativeMatrix = [
    linear[0], linear[1], linear[2], 0,
    linear[3], linear[4], linear[5], 0,
    linear[6], linear[7], linear[8], 0,
    pivotTranslation[0] + bone.pivot[0] + translation[0],
    pivotTranslation[1] + bone.pivot[1] + translation[1],
    pivotTranslation[2] + bone.pivot[2] + translation[2],
    1,
  ];
  return bone.parentIndex >= 0 && bones
    ? multiplyMatrices(boneMatrixAt(bones[bone.parentIndex], bones, timeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex), local)
    : local;
}

/** Emitter transform at a time: source transform * bone * T(emitter.position). */
function emitterMatrixAt(
  emitter: NativeParticleEmitter,
  bones: NativeBone[] | undefined,
  sourceTransformAtTime: (timeSeconds: number) => NativeMatrix,
  timeSeconds: number,
  timeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[],
  sequenceIndex: number,
): NativeMatrix {
  return multiplyMatrices(
    multiplyMatrices(
      sourceTransformAtTime(timeSeconds),
      boneMatrixAt(bones?.[emitter.boneIndex], bones, timeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex),
    ),
    translationMatrix(emitter.position),
  );
}

// ---------------------------------------------------------------------------
// Emission accumulator.
// ---------------------------------------------------------------------------

interface SpawnTime {
  spawnIndex: number;
  time: number;
}

/**
 * Births cross integer emission thresholds: the k-th particle is born when the
 * integrated rate reaches k (reference `while (emission > 1) spawn`), so no
 * particle exists at t = 0. The rate variation is drawn once per occurrence
 * and emitter and held constant; the reference redraws it per frame.
 */
function createSpawnTimes(
  emitter: NativeParticleEmitter,
  sequenceDurationMs: number,
  timeSeconds: number,
  globalSequenceDurationsMs: number[],
  sequenceIndex: number,
  occurrenceSeed: number,
): SpawnTime[] {
  if (timeSeconds <= 0) return [];
  const rateVariation = randomSigned(occurrenceSeed, emitter.index, 0, CHANNEL_RATE) * emitter.emissionRateVariation;
  const constantRate = getConstantTrackValue(emitter.emissionRate);
  if (constantRate !== null) {
    const rate = constantRate + rateVariation;
    if (rate <= 0) return [];
    const count = Math.max(0, Math.ceil(timeSeconds * rate - 1e-9) - 1);
    return Array.from({ length: count }, (_, spawnIndex) => ({
      spawnIndex,
      time: (spawnIndex + 1) / rate,
    }));
  }

  const result: SpawnTime[] = [];
  const step = 0.001;
  let accumulated = 0;
  let threshold = 1;
  let previousTime = 0;
  const rateAt = (time: number) => Math.max(0,
    sampleNativeTrack(emitter.emissionRate, time * 1000, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex) + rateVariation);
  let previousRate = rateAt(0);
  for (let currentTime = step; currentTime <= timeSeconds + step / 2; currentTime += step) {
    const boundedTime = Math.min(timeSeconds, currentTime);
    const currentRate = rateAt(boundedTime);
    const interval = boundedTime - previousTime;
    const nextAccumulated = accumulated + ((previousRate + currentRate) * 0.5) * interval;
    while (threshold <= nextAccumulated) {
      const ratio = nextAccumulated === accumulated ? 0 : (threshold - accumulated) / (nextAccumulated - accumulated);
      result.push({ spawnIndex: result.length, time: previousTime + interval * ratio });
      threshold += 1;
    }
    accumulated = nextAccumulated;
    previousRate = currentRate;
    previousTime = boundedTime;
    if (boundedTime >= timeSeconds) break;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Spawn generators.
// ---------------------------------------------------------------------------

interface EmissionSample {
  offset: Vector3Tuple;
  direction: Vector3Tuple;
}

function planeEmission(
  emitter: NativeParticleEmitter,
  occurrenceSeed: number,
  spawnIndex: number,
  spawnTimeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[],
  sequenceIndex: number,
  zSource: number,
): EmissionSample {
  const length = sampleNativeTrack(emitter.emissionAreaLength, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const width = sampleNativeTrack(emitter.emissionAreaWidth, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const offset: Vector3Tuple = [
    randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_PLANE_X) * length * 0.5,
    randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_PLANE_Y) * width * 0.5,
    0,
  ];
  if (zSource >= 0.001) {
    return { offset, direction: zSourceDirection(offset, zSource) };
  }
  const verticalRange = sampleNativeTrack(emitter.verticalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const horizontalRange = sampleNativeTrack(emitter.horizontalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const polar = verticalRange * randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_PLANE_POLAR);
  const azimuth = horizontalRange * randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_PLANE_AZIMUTH);
  return {
    offset,
    direction: normalize([
      Math.cos(azimuth) * Math.sin(polar),
      Math.sin(azimuth) * Math.sin(polar),
      Math.cos(polar),
    ]),
  };
}

function sphereEmission(
  emitter: NativeParticleEmitter,
  occurrenceSeed: number,
  spawnIndex: number,
  spawnTimeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[],
  sequenceIndex: number,
  zSource: number,
): EmissionSample {
  const length = sampleNativeTrack(emitter.emissionAreaLength, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const width = sampleNativeTrack(emitter.emissionAreaWidth, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const radius = length + (width - length) * randomUnit(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_SPHERE_RADIUS);
  const verticalRange = sampleNativeTrack(emitter.verticalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const horizontalRange = sampleNativeTrack(emitter.horizontalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const polar = verticalRange * randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_SPHERE_POLAR);
  const azimuth = horizontalRange * randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_SPHERE_AZIMUTH);
  const cosinePolar = Math.cos(polar);
  const radial: Vector3Tuple = [
    cosinePolar * Math.cos(azimuth),
    cosinePolar * Math.sin(azimuth),
    Math.sin(polar),
  ];
  const offset = scale(radial, radius);
  if (Math.abs(zSource) > 0.00001) {
    return { offset, direction: zSourceDirection(offset, zSource) };
  }
  return { offset, direction: (emitter.flags & 0x100) !== 0 ? [0, 0, 1] : radial };
}

/** Direction away from the z-source point (0, 0, zSource) in generator space. */
function zSourceDirection(offset: Vector3Tuple, zSource: number): Vector3Tuple {
  const relative = [offset[0], offset[1], offset[2] - zSource] as Vector3Tuple;
  const length = Math.hypot(...relative);
  // Below the reference tolerance the tiny unnormalized difference is kept.
  return length > 0.0001 ? scale(relative, 1 / length) : relative;
}

// ---------------------------------------------------------------------------
// Force integration.
// ---------------------------------------------------------------------------

/** Fixed simulation tick; the closed form below equals the reference per-step update at this tick. */
const INTEGRATION_TICK_SECONDS = 1 / 120;

interface IntegrationState {
  position: Vector3Tuple;
  velocity: Vector3Tuple;
}

function integrateStep(state: IntegrationState, wind: Vector3Tuple, gravity: Vector3Tuple, drag: number, delta: number): IntegrationState {
  // Reference UpdateParticle: wind drift first, displacement from the
  // pre-gravity velocity, then gravity and drag apply to the velocity.
  const drifted = add(state.velocity, scale(wind, delta));
  const displacement = scale(drifted, delta);
  const dragged = scale(add(drifted, scale(gravity, delta)), 1 - Math.min(drag * delta, 1));
  return {
    position: add(add(state.position, displacement), scale(gravity, 0.5 * delta * delta)),
    velocity: dragged,
  };
}

/**
 * Closed form of `integrateStep` run n times at the fixed tick, plus one
 * partial step of the remaining age. With k = 1 - min(drag*dt, 1),
 * u = k(wind + gravity)dt and S = (1 - k^n)/(1 - k):
 *   v_n = k^n v0 + u S
 *   p_n = p0 + dt (v0 S + u ((n-1) - n k + k^n)/(1-k)^2) + n (wind + gravity/2) dt^2
 */
function integrateParticle(
  origin: Vector3Tuple,
  velocity: Vector3Tuple,
  wind: Vector3Tuple,
  gravity: Vector3Tuple,
  drag: number,
  age: number,
): IntegrationState {
  let state: IntegrationState = { position: origin, velocity };
  if (age <= 0) return state;
  const dt = INTEGRATION_TICK_SECONDS;
  const stepCount = Math.floor(age / dt + 1e-9);
  if (stepCount > 0) {
    const acceleration = add(wind, gravity);
    const k = 1 - Math.min(drag * dt, 1);
    const kn = k ** stepCount;
    if (Math.abs(k - 1) < 1e-12) {
      const n = stepCount;
      const sumVelocity = add(scale(velocity, n), scale(acceleration, dt * n * (n - 1) / 2));
      state = {
        position: add(
          add(state.position, scale(sumVelocity, dt)),
          scale(add(wind, scale(gravity, 0.5)), n * dt * dt),
        ),
        velocity: add(scale(velocity, kn), scale(acceleration, n * dt)),
      };
    } else {
      const s = (1 - kn) / (1 - k);
      const u = scale(acceleration, k * dt);
      const tailFactor = ((stepCount - 1) - stepCount * k + kn) / ((1 - k) * (1 - k));
      const sumVelocity = add(scale(velocity, s), scale(u, tailFactor));
      state = {
        position: add(
          add(state.position, scale(sumVelocity, dt)),
          scale(add(wind, scale(gravity, 0.5)), stepCount * dt * dt),
        ),
        velocity: add(scale(velocity, kn), scale(u, s)),
      };
    }
  }
  const remaining = age - stepCount * dt;
  if (remaining > 0) state = integrateStep(state, wind, gravity, drag, remaining);
  return state;
}

// ---------------------------------------------------------------------------
// Particle sampling.
// ---------------------------------------------------------------------------

function sampleLifespan(
  emitter: NativeParticleEmitter,
  spawnTimeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[],
  sequenceIndex: number,
  occurrenceSeed: number,
  spawnIndex: number,
) {
  const lifespanBase = sampleNativeTrack(emitter.lifespan, spawnTimeMs, sequenceDurationMs, 0.05, globalSequenceDurationsMs, sequenceIndex);
  // Reference life state: quantized to int16 before scaling the variation.
  const lifeDraw = randomSigned(occurrenceSeed, emitter.index, spawnIndex, CHANNEL_LIFESPAN);
  const state = clamp(Math.trunc(lifeDraw * 32767 + (lifeDraw >= 0 ? 0.5 : -0.5)), -32767, 32767);
  return {
    lifespan: Math.max(0.001, lifespanBase + (state / 32767) * emitter.lifespanVariation),
    // Track sampling uses the maximum lifespan, not the particle's own.
    maxLifespan: lifespanBase + emitter.lifespanVariation,
  };
}

export function sampleNativeEmitter(
  emitter: NativeParticleEmitter,
  bone: NativeBone | undefined,
  sequenceDurationMs: number,
  timeSeconds: number,
  options: NativeEmitterSampleOptions = {},
): NativeParticleSample[] {
  const emissionEndSeconds = Math.max(0, options.emissionEndSeconds ?? Number.POSITIVE_INFINITY);
  const emissionSampleTime = Math.min(Math.max(timeSeconds, 0), emissionEndSeconds);
  const globalSequenceDurationsMs = options.globalSequenceDurationsMs ?? [];
  const sequenceIndex = options.sequenceIndex ?? 0;
  const occurrenceSeed = hashOccurrenceSeed(options.occurrenceSeed ?? "");
  const bones = options.bones ?? (bone ? [bone] : undefined);
  const spawnTimes = createSpawnTimes(emitter, sequenceDurationMs, emissionSampleTime, globalSequenceDurationsMs, sequenceIndex, occurrenceSeed)
    .filter((spawn) => !Number.isFinite(emissionEndSeconds) || spawn.time < emissionEndSeconds - 0.0000001);
  const modelScale = options.modelScale ?? 1;
  const sourceTransformAtTime = options.sourceTransformAtTime ?? (() => IDENTITY_MATRIX);
  const isLocalSpace = (emitter.flags & 0x10) !== 0;
  const tileCount = emitter.rows * emitter.columns;
  const textureIndexMask = tileCount - 1;
  // Random flipbook offset (flag 0x8000) is drawn once per emitter occurrence.
  const randomizedTextureOffset = (emitter.flags & 0x8000) !== 0
    ? Math.floor(randomUnit(occurrenceSeed, emitter.index, 0, CHANNEL_TEXTURE_OFFSET) * tileCount)
    : 0;
  const result: NativeParticleSample[] = [];
  // Death times of spawned particles, used for the burst-velocity empty-buffer gate.
  const deathTimes: number[] = [];

  for (const spawn of spawnTimes) {
    const spawnTimeMs = spawn.time * 1000;
    if (sampleNativeTrack(emitter.enabled, spawnTimeMs, sequenceDurationMs, 1, globalSequenceDurationsMs, sequenceIndex) === 0) continue;
    const { lifespan, maxLifespan } = sampleLifespan(emitter, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex, occurrenceSeed, spawn.spawnIndex);
    const age = timeSeconds - spawn.time;
    const hasBurstVelocity = (emitter.flags & 0x40) !== 0 && emitter.inheritVelocityScale !== 0;
    if (hasBurstVelocity) {
      for (let index = deathTimes.length - 1; index >= 0; index -= 1) {
        if (deathTimes[index] <= spawn.time) deathTimes.splice(index, 1);
      }
    }
    if (age < 0 || age > lifespan) {
      if (hasBurstVelocity) deathTimes.push(spawn.time + lifespan);
      continue;
    }
    const particleSeed = Math.floor(randomUnit(occurrenceSeed, emitter.index, spawn.spawnIndex, 0) * 65536);

    // A static EXP2 z-source replaces the legacy per-emitter track when the chunk exists.
    const authoredZSource = emitter.exp2
      ? emitter.exp2.zSource
      : sampleNativeTrack(emitter.zSource, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    const emission = emitter.emitterType === 1
      ? planeEmission(emitter, occurrenceSeed, spawn.spawnIndex, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex, authoredZSource)
      : sphereEmission(emitter, occurrenceSeed, spawn.spawnIndex, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex, authoredZSource);

    const speedBase = sampleNativeTrack(emitter.emissionSpeed, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    const speedVariation = sampleNativeTrack(emitter.speedVariation, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    // Full signed multiplicative range; negative results fly opposite the emission direction.
    const speed = speedBase * (1 + speedVariation * randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_SPEED));

    const birthMatrix = emitterMatrixAt(emitter, bones, sourceTransformAtTime, spawn.time, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex);
    let initialVelocity = scale(emission.direction, speed);
    let burstVelocity: Vector3Tuple = [0, 0, 0];
    if (hasBurstVelocity && deathTimes.length === 0) {
      // Reference burst: displacement over the previous 30 ms times the burst
      // multiplier, applied after the ordinary emitter-space velocity transform.
      const previous = emitterMatrixAt(emitter, bones, sourceTransformAtTime, spawn.time - 0.03, (spawn.time - 0.03) * 1000, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex);
      const displacement = [
        birthMatrix[12] - previous[12],
        birthMatrix[13] - previous[13],
        birthMatrix[14] - previous[14],
      ] as Vector3Tuple;
      const speedMultiplier = 1 + speedVariation * randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_BURST_SPEED);
      burstVelocity = scale(displacement, emitter.inheritVelocityScale * speedMultiplier);
    }
    if (hasBurstVelocity) deathTimes.push(spawn.time + lifespan);

    const gravity = sampleNativeTrack<Vector3Tuple>(emitter.gravity, spawnTimeMs, sequenceDurationMs, [0, 0, 0], globalSequenceDurationsMs, sequenceIndex);
    const wind = emitter.windVector;

    let position: Vector3Tuple;
    let velocity: Vector3Tuple;
    if (isLocalSpace) {
      // Local particles integrate in generator space and follow the current transform.
      if (burstVelocity.some((component) => component !== 0)) {
        initialVelocity = add(initialVelocity, inverseMatrixDirection(birthMatrix, burstVelocity));
      }
      const integrated = integrateParticle(emission.offset, initialVelocity, wind, gravity, emitter.drag, age);
      const currentMatrix = age === 0
        ? birthMatrix
        : emitterMatrixAt(emitter, bones, sourceTransformAtTime, timeSeconds, timeSeconds * 1000, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex);
      position = scaleAroundSource(transformMatrixPoint(currentMatrix, integrated.position), sourceTransformAtTime(timeSeconds), modelScale);
      velocity = scale(transformMatrixDirection(currentMatrix, integrated.velocity), modelScale);
    } else {
      // World particles freeze the birth transform and integrate in effect space.
      const origin = transformMatrixPoint(birthMatrix, emission.offset);
      const worldVelocity0 = add(transformMatrixDirection(birthMatrix, initialVelocity), burstVelocity);
      const integrated = integrateParticle(origin, worldVelocity0, wind, gravity, emitter.drag, age);
      position = scaleAroundSource(integrated.position, sourceTransformAtTime(spawn.time), modelScale);
      velocity = scale(integrated.velocity, modelScale);
    }

    const progress = clamp(age / Math.max(maxLifespan, 0.001), 0, 1);
    const color = sampleNativeParticleTrack<Vector3Tuple>(emitter.color, progress, [1, 1, 1]);
    const alpha = sampleNativeParticleTrack(emitter.alpha, progress, 1);
    const alphaCutoff = sampleNativeParticleTrack(emitter.alphaCutoff, progress, 0);

    // Twinkle: table lookup decides suppression and always weights the size.
    const twinkleMin = emitter.twinkleScale[0];
    const twinkleVary = emitter.twinkleScale[1] - twinkleMin;
    let tableIndex = 0;
    if (emitter.twinklePercent < 1 || twinkleVary !== 0) {
      tableIndex = (Math.trunc(age * emitter.twinkleSpeed) + particleSeed) & 127;
    }
    if (emitter.twinklePercent < TWINKLE_TABLE[tableIndex]) continue;
    const twinkleWeight = twinkleVary * TWINKLE_TABLE[tableIndex] + twinkleMin;

    const authoredSize = sampleNativeParticleTrack<Vector2Tuple>(emitter.scale, progress, [1, 1]);
    const usesIndependentSizeVariation = (emitter.flags & 0x80000) !== 0;
    // The reference draws the Y multiplier first for independent variation.
    const scaleVariationY = usesIndependentSizeVariation
      ? Math.max(0.000099999997, 1 + randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_SCALE_Y) * emitter.scaleVariation[1])
      : Math.max(0.000099999997, 1 + randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_SCALE_X) * emitter.scaleVariation[0]);
    const scaleVariationX = usesIndependentSizeVariation
      ? Math.max(0.000099999997, 1 + randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_SCALE_X) * emitter.scaleVariation[0])
      : scaleVariationY;
    const size: Vector2Tuple = [
      Math.max(0, authoredSize[0] * scaleVariationX * twinkleWeight * modelScale),
      Math.max(0, authoredSize[1] * scaleVariationY * twinkleWeight * modelScale),
    ];

    // Spin variations are only drawn when the reference gate passes; the quad
    // itself only rotates with a nonzero spin rate.
    const spinGate = emitter.baseSpin !== 0 || emitter.spinSpeedVariation !== 0;
    const baseSpin = spinGate
      ? emitter.baseSpin + randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_BASE_SPIN) * emitter.baseSpinVariation
      : emitter.baseSpin;
    const spinRate = spinGate
      ? emitter.spinSpeed + randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_SPIN_SPEED) * emitter.spinSpeedVariation
      : emitter.spinSpeed;
    let rotation = emitter.spinSpeed !== 0 || emitter.spinSpeedVariation !== 0 ? baseSpin + spinRate * age : 0;
    if ((emitter.flags & 0x200) !== 0 && (particleSeed & 1) !== 0) rotation = -rotation;

    let uvFrame: number;
    if (emitter.headUv.values.length > 0) {
      uvFrame = (Math.floor(sampleNativeParticleTrack(emitter.headUv, progress, 0)) + randomizedTextureOffset) & textureIndexMask;
    } else if ((emitter.flags & 0x10000) !== 0) {
      uvFrame = Math.floor(randomUnit(occurrenceSeed, emitter.index, spawn.spawnIndex, CHANNEL_RANDOM_CELL) * tileCount);
    } else {
      uvFrame = 0;
    }
    const tailUvFrame = (Math.floor(sampleNativeParticleTrack(emitter.tailUv, progress, 0)) + randomizedTextureOffset) & textureIndexMask;

    // Secondary/tertiary texture UVs: one random velocity scalar per channel
    // scales the param-1 vector; initial positions draw per axis. The
    // flipbook rect applies to the primary UV only.
    const uvScrollOffsets = (emitter.flags & 0x10000000) !== 0
      ? [0, 1].map((channel): Vector2Tuple => {
        const velocityScalar = randomSigned(occurrenceSeed, emitter.index, spawn.spawnIndex, MULTITEX_BASE_CHANNEL + channel);
        const axisOffset = (axis: 0 | 1) => {
          const initial = randomUnit(occurrenceSeed, emitter.index, spawn.spawnIndex, MULTITEX_BASE_CHANNEL + 2 + channel * 2 + axis);
          const velocity = emitter.multiTextureParam0[channel][axis] + velocityScalar * emitter.multiTextureParam1[channel][axis];
          const offset = initial + velocity * age;
          return offset - Math.floor(offset);
        };
        return [axisOffset(0), axisOffset(1)];
      }) as [Vector2Tuple, Vector2Tuple]
      : undefined;

    result.push({
      spawnIndex: spawn.spawnIndex,
      age,
      position,
      velocity,
      color,
      alpha: clamp(alpha, 0, 1),
      alphaCutoff,
      size,
      rotation,
      uvFrame,
      tailUvFrame,
      uvScrollOffsets,
    });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Ribbon sampling.
// ---------------------------------------------------------------------------

/**
 * Ribbon edges as a pure function of time, newest first. Edges are born at
 * integer multiples of ceil(edgesPerSecond)^-1 while emission is enabled; each
 * keeps aging (and sagging under gravity) until it exceeds the effective
 * lifetime max(authored, 0.25 s), so stopping emission does not erase edges.
 */
export function sampleNativeRibbonEdges(
  ribbon: NativeRibbonEmitter,
  bone: NativeBone | undefined,
  sequenceDurationMs: number,
  timeSeconds: number,
  options: NativeEmitterSampleOptions = {},
): NativeRibbonEdgeSample[] {
  if (timeSeconds < 0) return [];
  const emissionEndSeconds = Math.max(0, options.emissionEndSeconds ?? Number.POSITIVE_INFINITY);
  const globalSequenceDurationsMs = options.globalSequenceDurationsMs ?? [];
  const sequenceIndex = options.sequenceIndex ?? 0;
  const bones = options.bones ?? (bone ? [bone] : undefined);
  const modelScale = options.modelScale ?? 1;
  const sourceTransformAtTime = options.sourceTransformAtTime ?? (() => IDENTITY_MATRIX);
  const edgeRate = Math.ceil(ribbon.edgesPerSecond);
  if (edgeRate <= 0) return [];
  const lifetime = Math.max(0.25, ribbon.edgeLifetime);

  const sampleEdge = (birthSeconds: number): NativeRibbonEdgeSample => {
    const age = timeSeconds - birthSeconds;
    const birthMs = birthSeconds * 1000;
    const source = sourceTransformAtTime(birthSeconds);
    const matrix = multiplyMatrices(
      source,
      boneMatrixAt(bones?.[ribbon.boneIndex], bones, birthMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex),
    );
    const aboveHeight = sampleNativeTrack(ribbon.heightAbove, birthMs, sequenceDurationMs, 1, globalSequenceDurationsMs, sequenceIndex);
    const belowHeight = sampleNativeTrack(ribbon.heightBelow, birthMs, sequenceDurationMs, 1, globalSequenceDurationsMs, sequenceIndex);
    // The cross-section spans the emitter's own vertical axis (bone-local Z
    // through the birth transform); the reference reads column 1 of its
    // differently-based matrix.
    const point = (height: number): Vector3Tuple => {
      const sagged = transformMatrixPoint(matrix, [
        ribbon.position[0],
        ribbon.position[1],
        ribbon.position[2] + height,
      ]);
      const scaled = scaleAroundSource(sagged, source, modelScale);
      return [scaled[0], scaled[1], scaled[2] + ribbon.gravity * age * age * modelScale];
    };
    const color = sampleNativeTrack(ribbon.color, birthMs, sequenceDurationMs, [1, 1, 1] as Vector3Tuple, globalSequenceDurationsMs, sequenceIndex);
    const alpha = sampleNativeTrack(ribbon.alpha, birthMs, sequenceDurationMs, 1, globalSequenceDurationsMs, sequenceIndex);
    const slot = sampleNativeTrack(ribbon.textureSlot, birthMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    const frame = clamp(Math.floor(slot), 0, Math.max(0, ribbon.rows * ribbon.columns - 1));
    const column = frame % ribbon.columns;
    const row = Math.floor(frame / ribbon.columns);
    return {
      age,
      above: point(aboveHeight),
      below: point(-belowHeight),
      color,
      alpha,
      // Per-edge aging: u scrolls one cell per lifetime across the strip.
      u: column / ribbon.columns + (age / lifetime) / ribbon.columns,
      v: 1 - (row + 1) / ribbon.rows,
    };
  };

  const emissionWindowEnd = Math.min(timeSeconds, emissionEndSeconds);
  const lastGridBirthIndex = Math.floor(emissionWindowEnd * edgeRate + 1e-9);
  const edges: NativeRibbonEdgeSample[] = [];
  const isEnabled = (timeSeconds: number) =>
    sampleNativeTrack(ribbon.enabled, timeSeconds * 1000, sequenceDurationMs, 1, globalSequenceDurationsMs, sequenceIndex) !== 0;
  for (let index = lastGridBirthIndex; index >= 1; index -= 1) {
    const birth = index / edgeRate;
    if (timeSeconds - birth > lifetime) break;
    if (!isEnabled(birth)) continue;
    edges.push(sampleEdge(birth));
  }
  // Zero-advance endpoint edge at the current position while emitting.
  if (timeSeconds <= emissionEndSeconds && isEnabled(timeSeconds)) {
    edges.unshift(sampleEdge(timeSeconds));
  }
  return edges;
}
