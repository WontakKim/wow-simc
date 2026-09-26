import type {
  NativeBone,
  NativeParticleEmitter,
  NativeMeshVertex,
  NativeParticleTrack,
  NativeTrack,
  QuaternionTuple,
  Vector2Tuple,
  Vector3Tuple,
} from "./nativeM2";

export interface NativeParticleSample {
  spawnIndex: number;
  position: Vector3Tuple;
  velocity: Vector3Tuple;
  color: Vector3Tuple;
  alpha: number;
  alphaCutoff: number;
  size: Vector2Tuple;
  rotation: number;
  uvFrame: number;
}

export interface NativeEmitterSampleOptions {
  emissionEndSeconds?: number;
  modelScale?: number;
  sourceTranslationAtTime?: (timeSeconds: number) => Vector3Tuple;
  globalSequenceDurationsMs?: number[];
  bones?: NativeBone[];
  sequenceIndex?: number;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function interpolateValue<T>(first: T, second: T, ratio: number): T {
  if (typeof first === "number" && typeof second === "number") {
    return (first + (second - first) * ratio) as T;
  }
  if (Array.isArray(first) && Array.isArray(second)) {
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

function sampleSymmetricVariation(base: number, variation: number, randomValue: number) {
  return base + variation * (randomValue * 2 - 1);
}

function randomUnit(emitterIndex: number, spawnIndex: number, channel: number) {
  let value = Math.imul(emitterIndex + 1, 0x9e3779b1) ^ Math.imul(spawnIndex + 1, 0x85ebca6b) ^ Math.imul(channel + 1, 0xc2b2ae35);
  value ^= value >>> 16;
  value = Math.imul(value, 0x7feb352d);
  value ^= value >>> 15;
  value = Math.imul(value, 0x846ca68b);
  value ^= value >>> 16;
  return (value >>> 0) / 0x1_0000_0000;
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

function applyBonePoint(
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

interface SpawnTime {
  spawnIndex: number;
  time: number;
}

function createSpawnTimes(emitter: NativeParticleEmitter, sequenceDurationMs: number, timeSeconds: number, globalSequenceDurationsMs: number[] = [], sequenceIndex = 0): SpawnTime[] {
  if (timeSeconds < 0) return [];
  const constantRate = getConstantTrackValue(emitter.emissionRate);
  if (constantRate !== null) {
    const variedRate = Math.max(0, sampleSymmetricVariation(
      constantRate,
      emitter.emissionRateVariation,
      randomUnit(emitter.index, 0, 90),
    ));
    if (variedRate <= 0) return [];
    const finalIndex = Math.min(4095, Math.floor(timeSeconds * variedRate + 0.0000001));
    return Array.from({ length: finalIndex + 1 }, (_, spawnIndex) => ({
      spawnIndex,
      time: spawnIndex / variedRate,
    }));
  }

  const result: SpawnTime[] = [];
  const step = 0.001;
  let accumulated = 0;
  let threshold = 1;
  let previousTime = 0;
  let previousRate = Math.max(0, sampleNativeTrack(emitter.emissionRate, 0, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex));
  for (let currentTime = step; currentTime <= timeSeconds + step / 2 && result.length < 4096; currentTime += step) {
    const boundedTime = Math.min(timeSeconds, currentTime);
    const currentRate = Math.max(0, sampleNativeTrack(emitter.emissionRate, boundedTime * 1000, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex));
    const interval = boundedTime - previousTime;
    const nextAccumulated = accumulated + ((previousRate + currentRate) * 0.5) * interval;
    while (threshold <= nextAccumulated && result.length < 4096) {
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

function planeEmissionDirection(
  emitter: NativeParticleEmitter,
  spawnIndex: number,
  spawnTimeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[] = [],
  sequenceIndex = 0,
) {
  const verticalRange = Math.max(0, sampleNativeTrack(emitter.verticalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex));
  const horizontalRange = Math.max(0, sampleNativeTrack(emitter.horizontalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex));
  const inclination = randomUnit(emitter.index, spawnIndex, 1) * verticalRange;
  const azimuth = (randomUnit(emitter.index, spawnIndex, 2) * 2 - 1) * horizontalRange * 0.5;
  return normalize([
    Math.sin(inclination) * Math.cos(azimuth),
    Math.sin(inclination) * Math.sin(azimuth),
    Math.cos(inclination),
  ]);
}

interface EmissionSample {
  offset: Vector3Tuple;
  direction: Vector3Tuple;
}

function sampleEmission(
  emitter: NativeParticleEmitter,
  spawnIndex: number,
  spawnTimeMs: number,
  sequenceDurationMs: number,
  globalSequenceDurationsMs: number[] = [],
  sequenceIndex = 0,
): EmissionSample {
  const width = sampleNativeTrack(emitter.emissionAreaWidth, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  const length = sampleNativeTrack(emitter.emissionAreaLength, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
  if (emitter.emitterType === 1) {
    return {
      offset: [
        (randomUnit(emitter.index, spawnIndex, 3) - 0.5) * length,
        (randomUnit(emitter.index, spawnIndex, 4) - 0.5) * width,
        0,
      ],
      direction: planeEmissionDirection(emitter, spawnIndex, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex),
    };
  }

  const verticalRange = Math.max(0, sampleNativeTrack(emitter.verticalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex));
  const horizontalRange = Math.max(0, sampleNativeTrack(emitter.horizontalRange, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex));
  const elevation = (randomUnit(emitter.index, spawnIndex, 4) * 2 - 1) * verticalRange * 0.5;
  const azimuth = (randomUnit(emitter.index, spawnIndex, 13) * 2 - 1) * horizontalRange * 0.5;
  const cosineElevation = Math.cos(elevation);
  const radialDirection: Vector3Tuple = [
    cosineElevation * Math.cos(azimuth),
    cosineElevation * Math.sin(azimuth),
    Math.sin(elevation),
  ];
  const minimumRadius = Math.min(Math.abs(length), Math.abs(width));
  const maximumRadius = Math.max(Math.abs(length), Math.abs(width));
  const radius = minimumRadius + (maximumRadius - minimumRadius) * randomUnit(emitter.index, spawnIndex, 3);
  return {
    offset: scale(radialDirection, radius),
    direction: (emitter.flags & 0x100) !== 0 ? [0, 0, 1] : radialDirection,
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
  const emissionSampleTime = Math.min(timeSeconds, emissionEndSeconds);
  const globalSequenceDurationsMs = options.globalSequenceDurationsMs ?? [];
  const sequenceIndex = options.sequenceIndex ?? 0;
  const spawnTimes = createSpawnTimes(emitter, sequenceDurationMs, emissionSampleTime, globalSequenceDurationsMs, sequenceIndex)
    .filter((spawn) => !Number.isFinite(emissionEndSeconds) || spawn.time < emissionEndSeconds - 0.0000001);
  const modelScale = options.modelScale ?? 1;
  const sourceTranslationAtTime = options.sourceTranslationAtTime ?? (() => [0, 0, 0]);
  const result: NativeParticleSample[] = [];
  for (const spawn of spawnTimes) {
    const spawnTimeMs = spawn.time * 1000;
    if (sampleNativeTrack(emitter.enabled, spawnTimeMs, sequenceDurationMs, 1, globalSequenceDurationsMs, sequenceIndex) === 0) continue;
    const lifespanBase = sampleNativeTrack(emitter.lifespan, spawnTimeMs, sequenceDurationMs, 0.05, globalSequenceDurationsMs, sequenceIndex);
    const lifespan = Math.max(0.05, sampleSymmetricVariation(
      lifespanBase,
      emitter.lifespanVariation,
      randomUnit(emitter.index, spawn.spawnIndex, 0),
    ));
    const age = timeSeconds - spawn.time;
    if (age < -0.000001 || age > lifespan) continue;
    const progress = clamp(age / lifespan, 0, 1);

    const emission = sampleEmission(emitter, spawn.spawnIndex, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, sequenceIndex);
    const localOrigin = add(emitter.position, emission.offset);
    const authoredZSource = sampleNativeTrack(emitter.zSource, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    const localDirection = authoredZSource > 0
      ? normalize([-localOrigin[0], -localOrigin[1], authoredZSource - localOrigin[2]])
      : emission.direction;
    const usesWorldCoordinates = (emitter.flags & 0x10) !== 0;
    const origin = usesWorldCoordinates
      ? localOrigin
      : applyBonePoint(localOrigin, bone, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, options.bones, sequenceIndex);
    const direction = usesWorldCoordinates
      ? localDirection
      : applyBoneDirection(localDirection, bone, spawnTimeMs, sequenceDurationMs, globalSequenceDurationsMs, options.bones, sequenceIndex);
    const speedBase = sampleNativeTrack(emitter.emissionSpeed, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    const speedVariation = sampleNativeTrack(emitter.speedVariation, spawnTimeMs, sequenceDurationMs, 0, globalSequenceDurationsMs, sequenceIndex);
    // M2 documents the speed-variation field but not its native formula; this stable additive sampling is an explicit approximation.
    const speed = Math.max(0, speedBase + (randomUnit(emitter.index, spawn.spawnIndex, 5) - 0.5) * speedVariation);
    const initialVelocity = scale(direction, speed);
    const gravity = sampleNativeTrack<Vector3Tuple>(emitter.gravity, spawnTimeMs, sequenceDurationMs, [0, 0, 0], globalSequenceDurationsMs, sequenceIndex);
    const windAge = Math.max(0, age - emitter.windTime);
    const acceleration = add(gravity, windAge > 0 ? emitter.windVector : [0, 0, 0] as Vector3Tuple);
    const dragFactor = emitter.drag > 0 ? Math.exp(-emitter.drag * age) : 1;
    const travelFactor = emitter.drag > 0 ? (1 - dragFactor) / emitter.drag : age;
    const localPosition = add(add(origin, scale(initialVelocity, travelFactor)), scale(acceleration, 0.5 * age * age));
    const localVelocity = add(scale(initialVelocity, dragFactor), scale(acceleration, age));
    const sourceSampleTime = usesWorldCoordinates ? spawn.time : timeSeconds;
    const position = add(sourceTranslationAtTime(sourceSampleTime), scale(localPosition, modelScale));
    const velocity = scale(localVelocity, modelScale);

    const color = sampleNativeParticleTrack<Vector3Tuple>(emitter.color, progress, [1, 1, 1]);
    let alpha = sampleNativeParticleTrack(emitter.alpha, progress, 1);
    const alphaCutoff = sampleNativeParticleTrack(emitter.alphaCutoff, progress, 0);
    if (emitter.twinklePercent < 1 && emitter.twinkleSpeed > 0) {
      const cycle = (age * emitter.twinkleSpeed + randomUnit(emitter.index, spawn.spawnIndex, 6)) % 1;
      if (cycle > emitter.twinklePercent) alpha = 0;
    }
    const authoredSize = sampleNativeParticleTrack<Vector2Tuple>(emitter.scale, progress, [1, 1]);
    const sharedScaleVariation = 1 + (randomUnit(emitter.index, spawn.spawnIndex, 7) - 0.5) * emitter.scaleVariation[0];
    const twinkleScale = emitter.twinkleScale[0]
      + (emitter.twinkleScale[1] - emitter.twinkleScale[0]) * randomUnit(emitter.index, spawn.spawnIndex, 8);
    const usesIndependentSizeVariation = (emitter.flags & 0x80000) !== 0;
    const verticalScaleVariation = usesIndependentSizeVariation
      ? 1 + (randomUnit(emitter.index, spawn.spawnIndex, 14) - 0.5) * emitter.scaleVariation[1]
      : sharedScaleVariation;
    const size: Vector2Tuple = [
      Math.max(0, authoredSize[0] * sharedScaleVariation * twinkleScale * modelScale),
      Math.max(0, authoredSize[1] * verticalScaleVariation * twinkleScale * modelScale),
    ];
    const reverseSpin = (emitter.flags & 0x200) !== 0 && randomUnit(emitter.index, spawn.spawnIndex, 9) < 0.5 ? -1 : 1;
    const initialSpin = emitter.baseSpin + (randomUnit(emitter.index, spawn.spawnIndex, 10) - 0.5) * emitter.baseSpinVariation;
    const spinSpeed = emitter.spinSpeed + (randomUnit(emitter.index, spawn.spawnIndex, 11) - 0.5) * emitter.spinSpeedVariation;
    const tileCount = emitter.rows * emitter.columns;
    let uvFrame: number;
    if ((emitter.flags & 0x10000) !== 0) {
      uvFrame = Math.floor(randomUnit(emitter.index, spawn.spawnIndex, 12) * tileCount);
    } else if ((emitter.flags & 0x200000) !== 0) {
      uvFrame = Math.floor(randomUnit(emitter.index, spawn.spawnIndex, 12) * tileCount + progress * tileCount);
    } else if (emitter.headUv.values.length > 0) {
      uvFrame = Math.floor(sampleNativeParticleTrack(emitter.headUv, progress, 0));
    } else {
      uvFrame = Math.min(tileCount - 1, Math.floor(progress * tileCount));
    }

    result.push({
      spawnIndex: spawn.spawnIndex,
      position,
      velocity,
      color,
      alpha: clamp(alpha, 0, 1),
      alphaCutoff,
      size,
      rotation: (initialSpin + spinSpeed * age) * reverseSpin,
      uvFrame: ((uvFrame % tileCount) + tileCount) % tileCount,
    });
  }
  return result;
}
