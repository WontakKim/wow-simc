export type Vector2Tuple = [number, number];
export type Vector3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface NativeTrack<T> {
  interpolation: 0 | 1;
  globalSequence: number;
  sequences: Array<{ timestamps: number[]; values: T[] }>;
}

export interface NativeParticleTrack<T> {
  timestamps: number[];
  values: T[];
}

export interface NativeBone {
  flags: number;
  parentIndex: number;
  pivot: Vector3Tuple;
  translation: NativeTrack<Vector3Tuple>;
  rotation: NativeTrack<QuaternionTuple>;
  scale: NativeTrack<Vector3Tuple>;
}

export interface NativeParticleEmitter {
  index: number;
  flags: number;
  position: Vector3Tuple;
  boneIndex: number;
  textureIndices: number[];
  blendingType: 2 | 4;
  emitterType: 1 | 2;
  priorityPlane: number;
  rows: number;
  columns: number;
  emissionSpeed: NativeTrack<number>;
  speedVariation: NativeTrack<number>;
  verticalRange: NativeTrack<number>;
  horizontalRange: NativeTrack<number>;
  gravity: NativeTrack<Vector3Tuple>;
  lifespan: NativeTrack<number>;
  lifespanVariation: number;
  emissionRate: NativeTrack<number>;
  emissionRateVariation: number;
  emissionAreaWidth: NativeTrack<number>;
  emissionAreaLength: NativeTrack<number>;
  zSource: NativeTrack<number>;
  color: NativeParticleTrack<Vector3Tuple>;
  alpha: NativeParticleTrack<number>;
  scale: NativeParticleTrack<Vector2Tuple>;
  scaleVariation: Vector2Tuple;
  headUv: NativeParticleTrack<number>;
  tailUv: NativeParticleTrack<number>;
  tailLength: number;
  twinkleSpeed: number;
  twinklePercent: number;
  twinkleScale: Vector2Tuple;
  inheritVelocityScale: number;
  drag: number;
  baseSpin: number;
  baseSpinVariation: number;
  spinSpeed: number;
  spinSpeedVariation: number;
  tumbleMinimum: Vector3Tuple;
  tumbleMaximum: Vector3Tuple;
  windVector: Vector3Tuple;
  windTime: number;
  followSpeed1: number;
  followScale1: number;
  followSpeed2: number;
  followScale2: number;
  enabled: NativeTrack<number>;
}

export interface NativeM2Model {
  fileDataId: number;
  version: 272;
  sequenceDurationMs: number;
  textureFileDataIds: number[];
  bones: NativeBone[];
  emitters: NativeParticleEmitter[];
}

interface ArrayDescriptor {
  count: number;
  offset: number;
}

type TrackValueKind = "float" | "vector3" | "quaternion" | "uint8" | "gravity";
type ParticleValueKind = "vector3" | "fixed16" | "vector2" | "uint16";

const PARTICLE_STRIDE = 0x1ec;
const BONE_STRIDE = 0x58;
const SUPPORTED_PARTICLE_FLAGS =
  0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x100 | 0x200 | 0x10000 | 0x20000 | 0x800000;

function fourCc(source: Uint8Array, offset: number) {
  return String.fromCharCode(...source.subarray(offset, offset + 4));
}

function isZeroVector(value: Vector3Tuple) {
  return value[0] === 0 && value[1] === 0 && value[2] === 0;
}

export function parseNativeM2(sourceBuffer: ArrayBuffer, fileDataId: number): NativeM2Model {
  const sourceBytes = new Uint8Array(sourceBuffer);
  const source = new DataView(sourceBuffer);
  const label = `FileDataID ${fileDataId}`;
  const chunks = new Map<string, { offset: number; size: number }>();

  let chunkOffset = 0;
  while (chunkOffset < sourceBuffer.byteLength) {
    if (sourceBuffer.byteLength - chunkOffset < 8) {
      throw new Error(`${label}: chunk header is outside source bounds.`);
    }
    const tag = fourCc(sourceBytes, chunkOffset);
    const size = source.getUint32(chunkOffset + 4, true);
    const payloadOffset = chunkOffset + 8;
    if (size > sourceBuffer.byteLength - payloadOffset) {
      throw new Error(`${label}: ${tag} chunk payload is outside source bounds.`);
    }
    if (chunks.has(tag)) throw new Error(`${label}: duplicate ${tag} chunk.`);
    if (tag === "EXP2" || tag === "EXPT") {
      throw new Error(`${label}: ${tag} particle extensions are unsupported by this component proof.`);
    }
    if (tag !== "MD21" && tag !== "SFID" && tag !== "TXID") {
      throw new Error(`${label}: unsupported ${tag} chunk.`);
    }
    chunks.set(tag, { offset: payloadOffset, size });
    chunkOffset = payloadOffset + size;
  }

  const modelChunk = chunks.get("MD21");
  if (!modelChunk) throw new Error(`${label}: MD21 chunk is missing.`);
  const textureChunk = chunks.get("TXID");
  if (!textureChunk) throw new Error(`${label}: TXID chunk is missing.`);
  const skinChunk = chunks.get("SFID");
  if (!skinChunk || skinChunk.size !== 4) throw new Error(`${label}: exactly one SFID is required.`);

  const modelBase = modelChunk.offset;
  const modelSize = modelChunk.size;
  const checkModelBounds = (offset: number, byteLength: number, fieldLabel: string) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(byteLength) || offset < 0 || byteLength < 0 || offset > modelSize || byteLength > modelSize - offset) {
      throw new Error(`${label}: ${fieldLabel} is outside MD21 model bounds.`);
    }
  };
  const absolute = (offset: number, byteLength: number, fieldLabel: string) => {
    checkModelBounds(offset, byteLength, fieldLabel);
    return modelBase + offset;
  };
  const readArray = (descriptorOffset: number, fieldLabel: string): ArrayDescriptor => {
    const descriptor = absolute(descriptorOffset, 8, `${fieldLabel} descriptor`);
    const count = source.getUint32(descriptor, true);
    const offset = source.getUint32(descriptor + 4, true);
    if (count > 1_000_000) throw new Error(`${label}: ${fieldLabel} count ${count} is unreasonable.`);
    return { count, offset };
  };
  const checkArray = (descriptor: ArrayDescriptor, stride: number, fieldLabel: string) => {
    if (descriptor.count === 0) return;
    checkModelBounds(descriptor.offset, descriptor.count * stride, fieldLabel);
  };
  const getUint16 = (offset: number, fieldLabel: string) => source.getUint16(absolute(offset, 2, fieldLabel), true);
  const getInt16 = (offset: number, fieldLabel: string) => source.getInt16(absolute(offset, 2, fieldLabel), true);
  const getUint32 = (offset: number, fieldLabel: string) => source.getUint32(absolute(offset, 4, fieldLabel), true);
  const getFloat32 = (offset: number, fieldLabel: string) => source.getFloat32(absolute(offset, 4, fieldLabel), true);
  const getVector2 = (offset: number, fieldLabel: string): Vector2Tuple => [
    getFloat32(offset, `${fieldLabel}.x`),
    getFloat32(offset + 4, `${fieldLabel}.y`),
  ];
  const getVector3 = (offset: number, fieldLabel: string): Vector3Tuple => [
    getFloat32(offset, `${fieldLabel}.x`),
    getFloat32(offset + 4, `${fieldLabel}.y`),
    getFloat32(offset + 8, `${fieldLabel}.z`),
  ];

  checkModelBounds(0, 0x130, "MD20 header");
  if (fourCc(sourceBytes, modelBase) !== "MD20") throw new Error(`${label}: MD21 payload does not begin with MD20.`);
  const version = getUint32(4, "version");
  if (version !== 272) throw new Error(`${label}: M2 version ${version} is unsupported; this proof requires version 272.`);
  const globalFlags = getUint32(0x10, "global flags");
  const headerSize = (globalFlags & 0x8) !== 0 ? 0x138 : 0x130;
  checkModelBounds(0, headerSize, "MD20 header");

  const globalLoops = readArray(0x14, "global loops");
  checkArray(globalLoops, 4, "global loops");
  const sequences = readArray(0x1c, "sequences");
  checkArray(sequences, 0x40, "sequences");
  if (sequences.count === 0) throw new Error(`${label}: at least one animation sequence is required.`);
  const sequenceDurationMs = getUint32(sequences.offset + 4, "sequence 0 duration");
  if (sequenceDurationMs === 0) throw new Error(`${label}: animation sequence 0 has zero duration.`);

  const parseQuaternion = (offset: number, fieldLabel: string): QuaternionTuple => {
    const convert = (value: number) => (value < 0 ? value + 32768 : value - 32767) / 32767;
    return [
      convert(getInt16(offset, `${fieldLabel}.x`)),
      convert(getInt16(offset + 2, `${fieldLabel}.y`)),
      convert(getInt16(offset + 4, `${fieldLabel}.z`)),
      convert(getInt16(offset + 6, `${fieldLabel}.w`)),
    ];
  };
  const parseCompressedGravity = (offset: number, fieldLabel: string): Vector3Tuple => {
    const valueOffset = absolute(offset, 4, fieldLabel);
    const x = source.getInt8(valueOffset) / 128;
    const y = source.getInt8(valueOffset + 1) / 128;
    let z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    let magnitude = source.getInt16(valueOffset + 2, true) * 0.04238648;
    if (magnitude < 0) {
      z = -z;
      magnitude = -magnitude;
    }
    return [x * magnitude, y * magnitude, z * magnitude];
  };
  const trackValueSize = (kind: TrackValueKind) => {
    if (kind === "vector3") return 12;
    if (kind === "quaternion") return 8;
    if (kind === "uint8") return 1;
    return 4;
  };
  const parseTrack = <T>(offset: number, fieldLabel: string, kind: TrackValueKind): NativeTrack<T> => {
    const trackOffset = absolute(offset, 20, `${fieldLabel} track`);
    const interpolation = source.getUint16(trackOffset, true);
    if (interpolation !== 0 && interpolation !== 1) {
      throw new Error(`${label}: ${fieldLabel} interpolation ${interpolation} is unsupported.`);
    }
    const globalSequence = source.getInt16(trackOffset + 2, true);
    if (globalSequence >= 0) {
      throw new Error(`${label}: ${fieldLabel} global sequence ${globalSequence} is unsupported by this two-component proof.`);
    }
    const timestampDescriptors = readArray(offset + 4, `${fieldLabel} timestamps`);
    const valueDescriptors = readArray(offset + 12, `${fieldLabel} values`);
    if (timestampDescriptors.count !== valueDescriptors.count) {
      throw new Error(`${label}: ${fieldLabel} timestamp/value sequence counts differ.`);
    }
    checkArray(timestampDescriptors, 8, `${fieldLabel} timestamp descriptors`);
    checkArray(valueDescriptors, 8, `${fieldLabel} value descriptors`);
    const parsedSequences: NativeTrack<T>["sequences"] = [];
    for (let sequenceIndex = 0; sequenceIndex < timestampDescriptors.count; sequenceIndex += 1) {
      const timestampArray = readArray(timestampDescriptors.offset + sequenceIndex * 8, `${fieldLabel} sequence ${sequenceIndex} timestamps`);
      const valueArray = readArray(valueDescriptors.offset + sequenceIndex * 8, `${fieldLabel} sequence ${sequenceIndex} values`);
      if (timestampArray.count !== valueArray.count) {
        throw new Error(`${label}: ${fieldLabel} sequence ${sequenceIndex} key counts differ.`);
      }
      checkArray(timestampArray, 4, `${fieldLabel} sequence ${sequenceIndex} timestamps`);
      checkArray(valueArray, trackValueSize(kind), `${fieldLabel} sequence ${sequenceIndex} values`);
      const timestamps = Array.from({ length: timestampArray.count }, (_, keyIndex) =>
        getUint32(timestampArray.offset + keyIndex * 4, `${fieldLabel} timestamp`));
      const values = Array.from({ length: valueArray.count }, (_, keyIndex) => {
        const valueOffset = valueArray.offset + keyIndex * trackValueSize(kind);
        if (kind === "float") return getFloat32(valueOffset, `${fieldLabel} value`) as T;
        if (kind === "vector3") return getVector3(valueOffset, `${fieldLabel} value`) as T;
        if (kind === "quaternion") return parseQuaternion(valueOffset, `${fieldLabel} value`) as T;
        if (kind === "uint8") return source.getUint8(absolute(valueOffset, 1, `${fieldLabel} value`)) as T;
        return parseCompressedGravity(valueOffset, `${fieldLabel} value`) as T;
      });
      parsedSequences.push({ timestamps, values });
    }
    return { interpolation, globalSequence, sequences: parsedSequences };
  };
  const parseGravityTrack = (offset: number, fieldLabel: string, isCompressed: boolean): NativeTrack<Vector3Tuple> => {
    if (isCompressed) return parseTrack<Vector3Tuple>(offset, fieldLabel, "gravity");
    const scalarTrack = parseTrack<number>(offset, fieldLabel, "float");
    return {
      ...scalarTrack,
      sequences: scalarTrack.sequences.map((sequence) => ({
        timestamps: sequence.timestamps,
        values: sequence.values.map((value): Vector3Tuple => [0, 0, -value]),
      })),
    };
  };
  const particleValueSize = (kind: ParticleValueKind) => {
    if (kind === "vector3") return 12;
    if (kind === "vector2") return 8;
    return 2;
  };
  const parseParticleTrack = <T>(offset: number, fieldLabel: string, kind: ParticleValueKind): NativeParticleTrack<T> => {
    const timestamps = readArray(offset, `${fieldLabel} timestamps`);
    const values = readArray(offset + 8, `${fieldLabel} values`);
    if (timestamps.count !== values.count) throw new Error(`${label}: ${fieldLabel} timestamp/value key counts differ.`);
    checkArray(timestamps, 2, `${fieldLabel} timestamps`);
    checkArray(values, particleValueSize(kind), `${fieldLabel} values`);
    return {
      timestamps: Array.from({ length: timestamps.count }, (_, index) =>
        getUint16(timestamps.offset + index * 2, `${fieldLabel} timestamp`)),
      values: Array.from({ length: values.count }, (_, index) => {
        const valueOffset = values.offset + index * particleValueSize(kind);
        if (kind === "vector3") {
          return getVector3(valueOffset, `${fieldLabel} value`).map((component) => component / 255) as T;
        }
        if (kind === "vector2") return getVector2(valueOffset, `${fieldLabel} value`) as T;
        if (kind === "fixed16") return Math.max(0, getInt16(valueOffset, `${fieldLabel} value`) / 32767) as T;
        return getUint16(valueOffset, `${fieldLabel} value`) as T;
      }),
    };
  };

  const textureRecords = readArray(0x50, "textures");
  checkArray(textureRecords, 16, "textures");
  if (textureChunk.size % 4 !== 0) throw new Error(`${label}: TXID chunk size is not aligned.`);
  const textureFileDataIds = Array.from({ length: textureChunk.size / 4 }, (_, index) =>
    source.getUint32(textureChunk.offset + index * 4, true));
  if (textureRecords.count !== textureFileDataIds.length) {
    throw new Error(`${label}: texture record count ${textureRecords.count} does not match ${textureFileDataIds.length} TXIDs.`);
  }
  for (let index = 0; index < textureRecords.count; index += 1) {
    const textureOffset = textureRecords.offset + index * 16;
    const textureType = getUint32(textureOffset, `texture ${index} type`);
    const filename = readArray(textureOffset + 8, `texture ${index} filename`);
    if (textureType !== 0 || filename.count !== 0) {
      throw new Error(`${label}: texture ${index} uses unsupported embedded or replaceable data.`);
    }
  }

  const vertexRecords = readArray(0x3c, "vertices");
  if (vertexRecords.count !== 0) throw new Error(`${label}: mesh vertices are outside this particle-only proof.`);
  const ribbonRecords = readArray(0x120, "ribbons");
  if (ribbonRecords.count !== 0) throw new Error(`${label}: ribbon emitters are outside this component proof.`);

  const boneRecords = readArray(0x2c, "bones");
  checkArray(boneRecords, BONE_STRIDE, "bones");
  const bones = Array.from({ length: boneRecords.count }, (_, index): NativeBone => {
    const offset = boneRecords.offset + index * BONE_STRIDE;
    const parentIndex = getInt16(offset + 8, `bone ${index} parent`);
    if (parentIndex !== -1) {
      throw new Error(`${label}: bone ${index} requires a parented transform, which is unsupported by this two-component proof.`);
    }
    return {
      flags: getUint32(offset + 4, `bone ${index} flags`),
      parentIndex,
      translation: parseTrack(offset + 0x10, `bone ${index} translation`, "vector3"),
      rotation: parseTrack(offset + 0x24, `bone ${index} rotation`, "quaternion"),
      scale: parseTrack(offset + 0x38, `bone ${index} scale`, "vector3"),
      pivot: getVector3(offset + 0x4c, `bone ${index} pivot`),
    };
  });

  const particleRecords = readArray(0x128, "particle emitters");
  checkArray(particleRecords, PARTICLE_STRIDE, "particle emitters");
  if (particleRecords.count > 256) throw new Error(`${label}: particle emitter count ${particleRecords.count} is unreasonable.`);
  const emitters = Array.from({ length: particleRecords.count }, (_, index): NativeParticleEmitter => {
    const offset = particleRecords.offset + index * PARTICLE_STRIDE;
    const emitterLabel = `emitter ${index}`;
    const flags = getUint32(offset + 4, `${emitterLabel} flags`);
    const unsupportedFlags = flags & ~SUPPORTED_PARTICLE_FLAGS;
    if (unsupportedFlags !== 0) {
      throw new Error(`${label}: ${emitterLabel} requires unsupported particle flags 0x${unsupportedFlags.toString(16)}.`);
    }
    if ((flags & 0x20000) === 0) throw new Error(`${label}: ${emitterLabel} does not define a supported head particle.`);
    const particleModel = readArray(offset + 0x18, `${emitterLabel} particle model`);
    const childModel = readArray(offset + 0x20, `${emitterLabel} child model`);
    const hasModelFilename = (descriptor: ArrayDescriptor, fieldLabel: string) => {
      checkArray(descriptor, 1, fieldLabel);
      for (let byteIndex = 0; byteIndex < descriptor.count; byteIndex += 1) {
        if (source.getUint8(absolute(descriptor.offset + byteIndex, 1, fieldLabel)) !== 0) return true;
      }
      return false;
    };
    if (hasModelFilename(particleModel, `${emitterLabel} particle model`)
      || hasModelFilename(childModel, `${emitterLabel} child model`)) {
      throw new Error(`${label}: ${emitterLabel} model particles are unsupported.`);
    }
    const textureId = getUint16(offset + 0x16, `${emitterLabel} texture ID`);
    const textureIndices = [textureId & 0x1f, (textureId >> 5) & 0x1f, (textureId >> 10) & 0x1f];
    if (textureIndices[1] !== 0 || textureIndices[2] !== 0) {
      throw new Error(`${label}: ${emitterLabel} requires unsupported multi-texture indices.`);
    }
    if (textureIndices[0] >= textureFileDataIds.length) {
      throw new Error(`${label}: ${emitterLabel} texture index ${textureIndices[0]} is outside TXID bounds.`);
    }
    const blendingType = source.getUint8(absolute(offset + 0x28, 1, `${emitterLabel} blend`));
    if (blendingType !== 2 && blendingType !== 4) {
      throw new Error(`${label}: ${emitterLabel} blend ${blendingType} is unsupported.`);
    }
    const emitterType = source.getUint8(absolute(offset + 0x29, 1, `${emitterLabel} type`));
    if (emitterType !== 1 && emitterType !== 2) {
      throw new Error(`${label}: ${emitterLabel} type ${emitterType} is unsupported.`);
    }
    if (getUint16(offset + 0x2a, `${emitterLabel} color index`) !== 0) {
      throw new Error(`${label}: ${emitterLabel} particle color replacement is unsupported.`);
    }
    if (source.getUint16(absolute(offset + 0x2c, 2, `${emitterLabel} multi-texture scale`), true) !== 0) {
      throw new Error(`${label}: ${emitterLabel} multi-texture scale is unsupported.`);
    }
    const rows = getUint16(offset + 0x30, `${emitterLabel} rows`);
    const columns = getUint16(offset + 0x32, `${emitterLabel} columns`);
    if (rows === 0 || columns === 0 || rows * columns > 256) {
      throw new Error(`${label}: ${emitterLabel} has invalid texture grid ${rows}x${columns}.`);
    }
    const splinePoints = readArray(offset + 0x1c0, `${emitterLabel} spline points`);
    if (splinePoints.count !== 0) throw new Error(`${label}: ${emitterLabel} spline points are unsupported.`);
    const tumbleMinimum = getVector3(offset + 0x188, `${emitterLabel} tumble minimum`);
    const tumbleMaximum = getVector3(offset + 0x194, `${emitterLabel} tumble maximum`);
    if (!isZeroVector(tumbleMinimum) || !isZeroVector(tumbleMaximum)) {
      throw new Error(`${label}: ${emitterLabel} model-particle tumble is unsupported.`);
    }
    for (let byteIndex = 0; byteIndex < 16; byteIndex += 1) {
      if (source.getUint8(absolute(offset + 0x1dc + byteIndex, 1, `${emitterLabel} multi-texture scroll`)) !== 0) {
        throw new Error(`${label}: ${emitterLabel} multi-texture scroll is unsupported.`);
      }
    }
    const zSource = parseTrack<number>(offset + 0xf0, `${emitterLabel} zSource`, "float");
    if (zSource.sequences.some((sequence) => sequence.values.some((value) => value !== 0))) {
      throw new Error(`${label}: ${emitterLabel} nonzero zSource is unsupported by this stationary component proof.`);
    }

    return {
      index,
      flags,
      position: getVector3(offset + 8, `${emitterLabel} position`),
      boneIndex: getUint16(offset + 0x14, `${emitterLabel} bone`),
      textureIndices: [textureIndices[0]],
      blendingType,
      emitterType,
      priorityPlane: getInt16(offset + 0x2e, `${emitterLabel} priority plane`),
      rows,
      columns,
      emissionSpeed: parseTrack(offset + 0x34, `${emitterLabel} emissionSpeed`, "float"),
      speedVariation: parseTrack(offset + 0x48, `${emitterLabel} speedVariation`, "float"),
      verticalRange: parseTrack(offset + 0x5c, `${emitterLabel} verticalRange`, "float"),
      horizontalRange: parseTrack(offset + 0x70, `${emitterLabel} horizontalRange`, "float"),
      gravity: parseGravityTrack(offset + 0x84, `${emitterLabel} gravity`, (flags & 0x800000) !== 0),
      lifespan: parseTrack(offset + 0x98, `${emitterLabel} lifespan`, "float"),
      lifespanVariation: getFloat32(offset + 0xac, `${emitterLabel} lifespan variation`),
      emissionRate: parseTrack(offset + 0xb0, `${emitterLabel} emissionRate`, "float"),
      emissionRateVariation: getFloat32(offset + 0xc4, `${emitterLabel} emission rate variation`),
      emissionAreaWidth: parseTrack(offset + 0xc8, `${emitterLabel} emissionAreaWidth`, "float"),
      emissionAreaLength: parseTrack(offset + 0xdc, `${emitterLabel} emissionAreaLength`, "float"),
      zSource,
      color: parseParticleTrack(offset + 0x104, `${emitterLabel} color`, "vector3"),
      alpha: parseParticleTrack(offset + 0x114, `${emitterLabel} alpha`, "fixed16"),
      scale: parseParticleTrack(offset + 0x124, `${emitterLabel} scale`, "vector2"),
      scaleVariation: getVector2(offset + 0x134, `${emitterLabel} scale variation`),
      headUv: parseParticleTrack(offset + 0x13c, `${emitterLabel} head UV`, "uint16"),
      tailUv: parseParticleTrack(offset + 0x14c, `${emitterLabel} tail UV`, "uint16"),
      tailLength: getFloat32(offset + 0x15c, `${emitterLabel} tail length`),
      twinkleSpeed: getFloat32(offset + 0x160, `${emitterLabel} twinkle speed`),
      twinklePercent: getFloat32(offset + 0x164, `${emitterLabel} twinkle percent`),
      twinkleScale: getVector2(offset + 0x168, `${emitterLabel} twinkle scale`),
      inheritVelocityScale: getFloat32(offset + 0x170, `${emitterLabel} inherit velocity scale`),
      drag: getFloat32(offset + 0x174, `${emitterLabel} drag`),
      baseSpin: getFloat32(offset + 0x178, `${emitterLabel} base spin`),
      baseSpinVariation: getFloat32(offset + 0x17c, `${emitterLabel} base spin variation`),
      spinSpeed: getFloat32(offset + 0x180, `${emitterLabel} spin speed`),
      spinSpeedVariation: getFloat32(offset + 0x184, `${emitterLabel} spin speed variation`),
      tumbleMinimum,
      tumbleMaximum,
      windVector: getVector3(offset + 0x1a0, `${emitterLabel} wind`),
      windTime: getFloat32(offset + 0x1ac, `${emitterLabel} wind time`),
      followSpeed1: getFloat32(offset + 0x1b0, `${emitterLabel} follow speed 1`),
      followScale1: getFloat32(offset + 0x1b4, `${emitterLabel} follow scale 1`),
      followSpeed2: getFloat32(offset + 0x1b8, `${emitterLabel} follow speed 2`),
      followScale2: getFloat32(offset + 0x1bc, `${emitterLabel} follow scale 2`),
      enabled: parseTrack(offset + 0x1c8, `${emitterLabel} enabled`, "uint8"),
    };
  });

  for (const emitter of emitters) {
    if (emitter.boneIndex >= bones.length) {
      throw new Error(`${label}: emitter ${emitter.index} bone ${emitter.boneIndex} is outside bone bounds.`);
    }
  }

  return {
    fileDataId,
    version: 272,
    sequenceDurationMs,
    textureFileDataIds,
    bones,
    emitters,
  };
}
