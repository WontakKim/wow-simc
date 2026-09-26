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
  blendingType: 2 | 4 | 7;
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
  alphaCutoff: NativeParticleTrack<number>;
}

export interface NativeRibbonEmitter {
  index: number;
  boneIndex: number;
  position: Vector3Tuple;
  textureIndices: number[];
  materialIndices: number[];
  color: NativeTrack<Vector3Tuple>;
  alpha: NativeTrack<number>;
  heightAbove: NativeTrack<number>;
  heightBelow: NativeTrack<number>;
  edgesPerSecond: number;
  edgeLifetime: number;
  gravity: number;
  rows: number;
  columns: number;
  textureSlot: NativeTrack<number>;
  enabled: NativeTrack<number>;
  priorityPlane: number;
  colorIndex: number;
  textureTransformLookupIndex: number;
}

export interface NativeMeshVertex {
  position: Vector3Tuple;
  boneWeights: [number, number, number, number];
  boneIndices: [number, number, number, number];
  normal: Vector3Tuple;
  uv: [Vector2Tuple, Vector2Tuple];
}

export interface NativeMeshBatch {
  flags: number;
  priorityPlane: number;
  shaderId: number;
  sectionIndex: number;
  colorIndex: number;
  materialIndex: number;
  textureCount: number;
  textureComboIndex: number;
  textureCoordComboIndex: number;
  textureWeightComboIndex: number;
  textureTransformComboIndex: number;
}

export interface NativeSkinProfile {
  vertexLookup: number[];
  indices: number[];
  boneRemap: Array<[number, number, number, number]>;
  sections: Array<{ indexStart: number; indexCount: number; vertexStart: number; vertexCount: number; boneCount: number }>;
  batches: NativeMeshBatch[];
}

export interface NativeM2Model {
  fileDataId: number;
  version: 272 | 274;
  sequenceDurationsMs: number[];
  sequenceIds: number[];
  globalSequenceDurationsMs: number[];
  extensionChunks: string[];
  dboc?: { floats: [number, number]; integers: [number, number] };
  textureControlEntries: Array<[number, number]>;
  sequenceDurationMs: number;
  textureFileDataIds: number[];
  textureFlags: number[];
  skinFileDataIds: number[];
  vertices: NativeMeshVertex[];
  materials: Array<{ flags: number; blendMode: number }>;
  colors: Array<{ color: NativeTrack<Vector3Tuple>; alpha: NativeTrack<number> }>;
  textureWeights: NativeTrack<number>[];
  textureTransforms: Array<{ translation: NativeTrack<Vector3Tuple>; rotation: NativeTrack<QuaternionTuple>; scale: NativeTrack<Vector3Tuple> }>;
  textureLookup: number[];
  textureCoordinates: number[];
  textureWeightLookup: number[];
  textureTransformLookup: number[];
  bones: NativeBone[];
  emitters: NativeParticleEmitter[];
  ribbons: NativeRibbonEmitter[];
}

interface ArrayDescriptor {
  count: number;
  offset: number;
}

type TrackValueKind = "float" | "vector3" | "quaternion" | "uint8" | "uint16" | "gravity" | "fixed16";
type ParticleValueKind = "vector3" | "fixed16" | "vector2" | "uint16";

const PARTICLE_STRIDE = 0x1ec;
const BONE_STRIDE = 0x58;
const RIBBON_STRIDE = 0xb0;
const SUPPORTED_PARTICLE_FLAGS =
  0x1 | 0x2 | 0x4 | 0x8 | 0x10 | 0x20 | 0x40 | 0x100 | 0x200 | 0x400 | 0x8000 | 0x10000 | 0x20000 | 0x80000 | 0x100000 | 0x200000 | 0x800000 | 0x2000000 | 0x4000000 | 0x8000000 | 0x10000000 | 0x20000000 | 0x40000000;

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
    if (tag !== "MD21" && tag !== "SFID" && tag !== "TXID"
      && tag !== "TXAC" && tag !== "EXP2" && tag !== "PGD1" && tag !== "LDV1" && tag !== "DETL" && tag !== "DBOC") {
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
  if (!skinChunk || skinChunk.size < 4 || skinChunk.size % 4 !== 0) throw new Error(`${label}: at least one aligned SFID is required.`);

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
  if (version !== 272 && version !== 274) throw new Error(`${label}: M2 version ${version} is unsupported; only 272 and 274 are supported.`);
  const globalFlags = getUint32(0x10, "global flags");
  const headerSize = (globalFlags & 0x8) !== 0 ? 0x138 : 0x130;
  checkModelBounds(0, headerSize, "MD20 header");

  const globalLoops = readArray(0x14, "global loops");
  checkArray(globalLoops, 4, "global loops");
  const sequences = readArray(0x1c, "sequences");
  checkArray(sequences, 0x40, "sequences");
  if (sequences.count === 0) throw new Error(`${label}: at least one animation sequence is required.`);
  const sequenceDurationsMs = Array.from({ length: sequences.count }, (_, index) =>
    getUint32(sequences.offset + index * 0x40 + 4, `sequence ${index} duration`));
  const sequenceIds = Array.from({ length: sequences.count }, (_, index) =>
    getUint16(sequences.offset + index * 0x40, `sequence ${index} animation ID`));
  const sequenceDurationMs = sequenceDurationsMs[0];
  if (sequenceDurationMs === 0) throw new Error(`${label}: animation sequence 0 has zero duration.`);
  const globalSequenceDurationsMs = Array.from({ length: globalLoops.count }, (_, index) =>
    getUint32(globalLoops.offset + index * 4, `global sequence ${index} duration`));

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
    if (kind === "uint16") return 2;
    if (kind === "fixed16") return 2;
    return 4;
  };
  const parseTrack = <T>(offset: number, fieldLabel: string, kind: TrackValueKind): NativeTrack<T> => {
    const trackOffset = absolute(offset, 20, `${fieldLabel} track`);
    const interpolation = source.getUint16(trackOffset, true);
    if (interpolation !== 0 && interpolation !== 1) {
      throw new Error(`${label}: ${fieldLabel} interpolation ${interpolation} is unsupported.`);
    }
    const globalSequence = source.getInt16(trackOffset + 2, true);
    if (globalSequence >= globalSequenceDurationsMs.length) {
      throw new Error(`${label}: ${fieldLabel} global sequence ${globalSequence} is out of bounds.`);
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
        if (kind === "uint16") return getUint16(valueOffset, `${fieldLabel} value`) as T;
        if (kind === "fixed16") return Math.max(0, getInt16(valueOffset, `${fieldLabel} value`) / 32767) as T;
        return parseCompressedGravity(valueOffset, `${fieldLabel} value`) as T;
      });
      parsedSequences.push({ timestamps, values });
    }
    if (globalSequence >= 0 && globalSequenceDurationsMs[globalSequence] === 0
      && parsedSequences.some((sequence) => sequence.values.length > 1)) {
      throw new Error(`${label}: ${fieldLabel} global sequence ${globalSequence} has zero duration and multiple keys.`);
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

  const readChunkArray = (tag: string, descriptorOffset: number, stride: number, expectedCount: number) => {
    const chunk = chunks.get(tag);
    if (!chunk) return null;
    if (descriptorOffset + 8 > chunk.size) throw new Error(`${label}: ${tag} array descriptor is truncated.`);
    const count = source.getUint32(chunk.offset + descriptorOffset, true);
    const offset = source.getUint32(chunk.offset + descriptorOffset + 4, true);
    if (count !== expectedCount || offset > chunk.size || count * stride > chunk.size - offset) {
      throw new Error(`${label}: ${tag} array does not match ${expectedCount} particle emitters or is outside chunk bounds.`);
    }
    return { chunk, count, offset };
  };
  const readExtendedParticleTrack = (index: number): NativeParticleTrack<number> => {
    const array = readChunkArray("EXP2", 0, 28, particleRecords.count);
    if (!array) return { timestamps: [], values: [] };
    const base = array.chunk.offset + array.offset + index * 28;
    const zSource = source.getFloat32(base, true);
    const colorMultiplier = source.getFloat32(base + 4, true);
    const alphaMultiplier = source.getFloat32(base + 8, true);
    if (zSource !== 0 || colorMultiplier !== 1 || alphaMultiplier !== 1) {
      throw new Error(`${label}: emitter ${index} EXP2 zSource/color/alpha multipliers require unsupported values ${zSource}/${colorMultiplier}/${alphaMultiplier}.`);
    }
    const timeCount = source.getUint32(base + 12, true);
    const timeOffset = source.getUint32(base + 16, true);
    const valueCount = source.getUint32(base + 20, true);
    const valueOffset = source.getUint32(base + 24, true);
    if (timeCount !== valueCount || timeCount > 256 || timeOffset > array.chunk.size
      || timeCount * 2 > array.chunk.size - timeOffset || valueOffset > array.chunk.size
      || valueCount * 2 > array.chunk.size - valueOffset) {
      throw new Error(`${label}: emitter ${index} EXP2 alpha cutoff track is outside chunk bounds.`);
    }
    return {
      timestamps: Array.from({ length: timeCount }, (_, key) => source.getUint16(array.chunk.offset + timeOffset + key * 2, true)),
      values: Array.from({ length: valueCount }, (_, key) =>
        Math.max(0, source.getInt16(array.chunk.offset + valueOffset + key * 2, true) / 32767)),
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
  const textureFlags: number[] = [];
  for (let index = 0; index < textureRecords.count; index += 1) {
    const textureOffset = textureRecords.offset + index * 16;
    const textureType = getUint32(textureOffset, `texture ${index} type`);
    textureFlags.push(getUint32(textureOffset + 4, `texture ${index} flags`));
    const filename = readArray(textureOffset + 8, `texture ${index} filename`);
    if (textureType !== 0 || filename.count !== 0) {
      throw new Error(`${label}: texture ${index} uses unsupported embedded or replaceable data.`);
    }
  }

  const vertexRecords = readArray(0x3c, "vertices");
  checkArray(vertexRecords, 0x30, "vertices");
  const skinFileDataIds = Array.from({ length: skinChunk.size / 4 }, (_, index) =>
    source.getUint32(skinChunk.offset + index * 4, true));
  if (skinFileDataIds.some((id) => id === 0 || skinFileDataIds.indexOf(id) !== skinFileDataIds.lastIndexOf(id))) {
    throw new Error(`${label}: SFID contains zero or duplicate skin FileDataIDs.`);
  }
  const vertices = Array.from({ length: vertexRecords.count }, (_, index): NativeMeshVertex => {
    const offset = vertexRecords.offset + index * 0x30;
    const byteOffset = absolute(offset + 12, 8, `vertex ${index} skin weights`);
    return {
      position: getVector3(offset, `vertex ${index} position`),
      boneWeights: [0, 1, 2, 3].map((slot) => source.getUint8(byteOffset + slot)) as NativeMeshVertex["boneWeights"],
      boneIndices: [0, 1, 2, 3].map((slot) => source.getUint8(byteOffset + 4 + slot)) as NativeMeshVertex["boneIndices"],
      normal: getVector3(offset + 20, `vertex ${index} normal`),
      uv: [getVector2(offset + 32, `vertex ${index} UV0`), getVector2(offset + 40, `vertex ${index} UV1`)],
    };
  });
  const readUint16Array = (offset: number, field: string, signed = false) => {
    const descriptor = readArray(offset, field);
    checkArray(descriptor, 2, field);
    return Array.from({ length: descriptor.count }, (_, index) => signed
      ? getInt16(descriptor.offset + index * 2, field)
      : getUint16(descriptor.offset + index * 2, field));
  };
  const materialsRecord = readArray(0x70, "materials");
  checkArray(materialsRecord, 4, "materials");
  const materials = Array.from({ length: materialsRecord.count }, (_, index) => ({
    flags: getUint16(materialsRecord.offset + index * 4, `material ${index} flags`),
    blendMode: getUint16(materialsRecord.offset + index * 4 + 2, `material ${index} blend mode`),
  }));
  const colorsRecord = readArray(0x48, "mesh colors");
  checkArray(colorsRecord, 40, "mesh colors");
  const colors = Array.from({ length: colorsRecord.count }, (_, index) => ({
    color: parseTrack<Vector3Tuple>(colorsRecord.offset + index * 40, `mesh color ${index}`, "vector3"),
    alpha: parseTrack<number>(colorsRecord.offset + index * 40 + 20, `mesh alpha ${index}`, "fixed16"),
  }));
  const weightsRecord = readArray(0x58, "texture weights");
  checkArray(weightsRecord, 20, "texture weights");
  const textureWeights = Array.from({ length: weightsRecord.count }, (_, index) =>
    parseTrack<number>(weightsRecord.offset + index * 20, `texture weight ${index}`, "fixed16"));
  const transformsRecord = readArray(0x60, "texture transforms");
  checkArray(transformsRecord, 60, "texture transforms");
  const textureTransforms = Array.from({ length: transformsRecord.count }, (_, index) => ({
    translation: parseTrack<Vector3Tuple>(transformsRecord.offset + index * 60, `texture transform ${index} translation`, "vector3"),
    rotation: parseTrack<QuaternionTuple>(transformsRecord.offset + index * 60 + 20, `texture transform ${index} rotation`, "quaternion"),
    scale: parseTrack<Vector3Tuple>(transformsRecord.offset + index * 60 + 40, `texture transform ${index} scale`, "vector3"),
  }));
  const textureLookup = readUint16Array(0x80, "texture lookup");
  const textureCoordinates = readUint16Array(0x88, "texture coordinate lookup", true);
  const textureWeightLookup = readUint16Array(0x90, "texture weight lookup");
  const textureTransformLookup = readUint16Array(0x98, "texture transform lookup", true);
  const ribbonRecords = readArray(0x120, "ribbons");
  checkArray(ribbonRecords, RIBBON_STRIDE, "ribbons");
  if (ribbonRecords.count > 256) throw new Error(`${label}: ribbon count ${ribbonRecords.count} is unreasonable.`);

  const boneRecords = readArray(0x2c, "bones");
  checkArray(boneRecords, BONE_STRIDE, "bones");
  const bones = Array.from({ length: boneRecords.count }, (_, index): NativeBone => {
    const offset = boneRecords.offset + index * BONE_STRIDE;
    const parentIndex = getInt16(offset + 8, `bone ${index} parent`);
    if (parentIndex < -1 || parentIndex >= index) {
      throw new Error(`${label}: bone ${index} parent ${parentIndex} is not an earlier valid bone.`);
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

  const ribbons = Array.from({ length: ribbonRecords.count }, (_, index): NativeRibbonEmitter => {
    const offset = ribbonRecords.offset + index * RIBBON_STRIDE;
    const ribbonLabel = `ribbon ${index}`;
    const textureIndices = readArray(offset + 0x14, `${ribbonLabel} textures`);
    const materialIndices = readArray(offset + 0x1c, `${ribbonLabel} materials`);
    checkArray(textureIndices, 2, `${ribbonLabel} textures`);
    checkArray(materialIndices, 2, `${ribbonLabel} materials`);
    const readIndices = (descriptor: ArrayDescriptor, field: string) => Array.from({ length: descriptor.count }, (_, item) =>
      getUint16(descriptor.offset + item * 2, `${ribbonLabel} ${field} ${item}`));
    const textures = readIndices(textureIndices, "texture");
    const materialsUsed = readIndices(materialIndices, "material");
    if (textures.length === 0 || textures.some((value) => value >= textureFileDataIds.length)) {
      throw new Error(`${label}: ${ribbonLabel} texture index is outside texture bounds.`);
    }
    if (materialsUsed.length === 0 || materialsUsed.some((value) => value >= materials.length)) {
      throw new Error(`${label}: ${ribbonLabel} material index is outside material bounds.`);
    }
    const boneIndex = getUint32(offset + 4, `${ribbonLabel} bone`);
    if (boneIndex >= bones.length) throw new Error(`${label}: ${ribbonLabel} bone ${boneIndex} is outside bone bounds.`);
    const rows = getUint16(offset + 0x80, `${ribbonLabel} rows`);
    const columns = getUint16(offset + 0x82, `${ribbonLabel} columns`);
    if (rows === 0 || columns === 0) throw new Error(`${label}: ${ribbonLabel} has an empty texture grid.`);
    return {
      index, boneIndex, position: getVector3(offset + 8, `${ribbonLabel} position`),
      textureIndices: textures, materialIndices: materialsUsed,
      color: parseTrack(offset + 0x24, `${ribbonLabel} color`, "vector3"),
      alpha: parseTrack(offset + 0x38, `${ribbonLabel} alpha`, "fixed16"),
      heightAbove: parseTrack(offset + 0x4c, `${ribbonLabel} height above`, "float"),
      heightBelow: parseTrack(offset + 0x60, `${ribbonLabel} height below`, "float"),
      edgesPerSecond: getFloat32(offset + 0x74, `${ribbonLabel} edges per second`),
      edgeLifetime: getFloat32(offset + 0x78, `${ribbonLabel} edge lifetime`),
      gravity: getFloat32(offset + 0x7c, `${ribbonLabel} gravity`), rows, columns,
      textureSlot: parseTrack(offset + 0x84, `${ribbonLabel} texture slot`, "uint16"),
      enabled: parseTrack(offset + 0x98, `${ribbonLabel} enabled`, "uint8"),
      priorityPlane: getInt16(offset + 0xac, `${ribbonLabel} priority plane`),
      colorIndex: source.getInt8(absolute(offset + 0xae, 1, `${ribbonLabel} color index`)),
      textureTransformLookupIndex: source.getInt8(absolute(offset + 0xaf, 1, `${ribbonLabel} texture transform lookup index`)),
    };
  });

  const particleRecords = readArray(0x128, "particle emitters");
  const textureAlphaChunk = chunks.get("TXAC");
  if (textureAlphaChunk && (textureAlphaChunk.size < particleRecords.count * 2 || textureAlphaChunk.size % 2 !== 0)) {
    throw new Error(`${label}: TXAC particle entries are fewer than ${particleRecords.count} emitters or not aligned.`);
  }
  const textureControlEntries: Array<[number, number]> = textureAlphaChunk
    ? Array.from({ length: textureAlphaChunk.size / 2 }, (_, index) => [
      source.getUint8(textureAlphaChunk.offset + index * 2),
      source.getUint8(textureAlphaChunk.offset + index * 2 + 1),
    ]) : [];
  const particleGeosets = readChunkArray("PGD1", 0, 2, particleRecords.count);
  if (particleGeosets) {
    for (let index = 0; index < particleRecords.count; index += 1) {
      const value = source.getUint16(particleGeosets.chunk.offset + particleGeosets.offset + index * 2, true);
      if (value !== 0) throw new Error(`${label}: PGD1 emitter ${index} geoset ${value} is unsupported.`);
    }
  }
  const lodChunk = chunks.get("LDV1");
  if (lodChunk && lodChunk.size !== 16) throw new Error(`${label}: LDV1 has unsupported size ${lodChunk.size}.`);
  const detailChunk = chunks.get("DETL");
  if (detailChunk && detailChunk.size % 16 !== 0) throw new Error(`${label}: DETL light data has invalid size.`);
  const dbocChunk = chunks.get("DBOC");
  if (dbocChunk && dbocChunk.size !== 16) throw new Error(`${label}: DBOC has unsupported size ${dbocChunk.size}.`);
  const dboc = dbocChunk ? {
    floats: [source.getFloat32(dbocChunk.offset, true), source.getFloat32(dbocChunk.offset + 4, true)] as [number, number],
    integers: [source.getUint32(dbocChunk.offset + 8, true), source.getUint32(dbocChunk.offset + 12, true)] as [number, number],
  } : undefined;
  readChunkArray("EXP2", 0, 28, particleRecords.count);
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
    const usesMultipleTextures = (flags & 0x10000000) !== 0;
    if (!usesMultipleTextures && (textureIndices[1] !== 0 || textureIndices[2] !== 0)) {
      throw new Error(`${label}: ${emitterLabel} has multi-texture indices without the multi-texture flag.`);
    }
    for (const textureIndex of usesMultipleTextures ? textureIndices : textureIndices.slice(0, 1)) {
      if (textureIndex >= textureFileDataIds.length) {
        throw new Error(`${label}: ${emitterLabel} texture index ${textureIndex} is outside TXID bounds.`);
      }
    }
    const blendingType = source.getUint8(absolute(offset + 0x28, 1, `${emitterLabel} blend`));
    if (blendingType !== 2 && blendingType !== 4 && blendingType !== 7) {
      throw new Error(`${label}: ${emitterLabel} blend ${blendingType} is unsupported.`);
    }
    const emitterType = source.getUint8(absolute(offset + 0x29, 1, `${emitterLabel} type`));
    if (emitterType !== 1 && emitterType !== 2) {
      throw new Error(`${label}: ${emitterLabel} type ${emitterType} is unsupported.`);
    }
    if (getUint16(offset + 0x2a, `${emitterLabel} color index`) !== 0) {
      throw new Error(`${label}: ${emitterLabel} particle color replacement is unsupported.`);
    }
    if (!usesMultipleTextures && (flags & 0x100000) === 0
      && source.getUint16(absolute(offset + 0x2c, 2, `${emitterLabel} multi-texture scale`), true) !== 0) {
      throw new Error(`${label}: ${emitterLabel} multi-texture scale without multi-texture flag is unsupported.`);
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
    if (!usesMultipleTextures && (flags & 0x100000) === 0) {
      for (let byteIndex = 0; byteIndex < 16; byteIndex += 1) {
        if (source.getUint8(absolute(offset + 0x1dc + byteIndex, 1, `${emitterLabel} multi-texture scroll`)) !== 0) {
          throw new Error(`${label}: ${emitterLabel} multi-texture scroll without multi-texture flag is unsupported.`);
        }
      }
    }
    const zSource = parseTrack<number>(offset + 0xf0, `${emitterLabel} zSource`, "float");

    return {
      index,
      flags,
      position: getVector3(offset + 8, `${emitterLabel} position`),
      boneIndex: getUint16(offset + 0x14, `${emitterLabel} bone`),
      textureIndices: usesMultipleTextures ? textureIndices : [textureIndices[0]],
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
      alphaCutoff: readExtendedParticleTrack(index),
    };
  });

  for (const emitter of emitters) {
    if (emitter.boneIndex >= bones.length) {
      throw new Error(`${label}: emitter ${emitter.index} bone ${emitter.boneIndex} is outside bone bounds.`);
    }
  }

  return {
    fileDataId,
    version,
    sequenceDurationMs,
    sequenceDurationsMs,
    sequenceIds,
    globalSequenceDurationsMs,
    extensionChunks: [...chunks.keys()].filter((tag) => !["MD21", "SFID", "TXID"].includes(tag)),
    dboc,
    textureControlEntries,
    textureFileDataIds,
    textureFlags,
    skinFileDataIds,
    vertices,
    materials,
    colors,
    textureWeights,
    textureTransforms,
    textureLookup,
    textureCoordinates,
    textureWeightLookup,
    textureTransformLookup,
    bones,
    emitters,
    ribbons,
  };
}

export function parseNativeSkin(sourceBuffer: ArrayBuffer, fileDataId: number, vertexCount: number): NativeSkinProfile {
  const label = `FileDataID ${fileDataId}`;
  const bytes = new Uint8Array(sourceBuffer);
  const view = new DataView(sourceBuffer);
  if (bytes.length < 0x40 || fourCc(bytes, 0) !== "SKIN") throw new Error(`${label}: SKIN header is missing or truncated.`);
  const readArray = (offset: number, stride: number, field: string) => {
    const count = view.getUint32(offset, true);
    const start = view.getUint32(offset + 4, true);
    if (count > 1_000_000 || start > bytes.length || count * stride > bytes.length - start) {
      throw new Error(`${label}: ${field} array is outside SKIN bounds.`);
    }
    return { count, start };
  };
  const vertexArray = readArray(4, 2, "vertex lookup");
  const indexArray = readArray(12, 2, "triangle indices");
  const boneArray = readArray(20, 4, "bone remap");
  const sectionArray = readArray(28, 0x30, "sections");
  const batchArray = readArray(36, 0x18, "batches");
  readArray(48, 12, "shadow batches");
  if (vertexArray.count === 0 || indexArray.count % 3 !== 0 || boneArray.count !== vertexArray.count
    || sectionArray.count === 0 || batchArray.count === 0) {
    throw new Error(`${label}: SKIN vertex, triangle, bone, section, or batch counts are invalid.`);
  }
  const vertexLookup = Array.from({ length: vertexArray.count }, (_, index) => view.getUint16(vertexArray.start + index * 2, true));
  const indices = Array.from({ length: indexArray.count }, (_, index) => view.getUint16(indexArray.start + index * 2, true));
  const boneRemap = Array.from({ length: boneArray.count }, (_, index): [number, number, number, number] =>
    [0, 1, 2, 3].map((slot) => view.getUint8(boneArray.start + index * 4 + slot)) as [number, number, number, number]);
  if (vertexLookup.some((index) => index >= vertexCount)) throw new Error(`${label}: vertex lookup is outside M2 vertex bounds.`);
  if (indices.some((index) => index >= vertexLookup.length)) throw new Error(`${label}: triangle index is outside SKIN vertex bounds.`);
  const sections = Array.from({ length: sectionArray.count }, (_, index) => {
    const offset = sectionArray.start + index * 0x30;
    const level = view.getUint16(offset + 2, true);
    const vertexStart = view.getUint16(offset + 4, true) + level * 65536;
    const vertexCountInSection = view.getUint16(offset + 6, true);
    const indexStart = view.getUint16(offset + 8, true) + level * 65536;
    const indexCount = view.getUint16(offset + 10, true);
    const boneCount = view.getUint16(offset + 12, true);
    if (vertexStart + vertexCountInSection > vertexLookup.length || indexStart + indexCount > indices.length
      || indexCount % 3 !== 0 || boneCount === 0) {
      throw new Error(`${label}: section ${index} indices, vertices or bone count are invalid.`);
    }
    if (indices.slice(indexStart, indexStart + indexCount).some((vertex) =>
      vertex < vertexStart || vertex >= vertexStart + vertexCountInSection)) {
      throw new Error(`${label}: section ${index} triangle refers outside its vertex range.`);
    }
    return { vertexStart, vertexCount: vertexCountInSection, indexStart, indexCount, boneCount };
  });
  const batches = Array.from({ length: batchArray.count }, (_, index): NativeMeshBatch => {
    const offset = batchArray.start + index * 0x18;
    const sectionIndex = view.getUint16(offset + 4, true);
    const textureCount = view.getUint16(offset + 14, true);
    if (sectionIndex >= sections.length || textureCount < 1 || textureCount > 4) {
      throw new Error(`${label}: batch ${index} section or texture count is invalid.`);
    }
    return {
      flags: view.getUint8(offset), priorityPlane: view.getInt8(offset + 1),
      shaderId: view.getUint16(offset + 2, true), sectionIndex,
      colorIndex: view.getInt16(offset + 8, true), materialIndex: view.getUint16(offset + 10, true),
      textureCount, textureComboIndex: view.getUint16(offset + 16, true),
      textureCoordComboIndex: view.getUint16(offset + 18, true),
      textureWeightComboIndex: view.getUint16(offset + 20, true),
      textureTransformComboIndex: view.getUint16(offset + 22, true),
    };
  });
  return { vertexLookup, indices, boneRemap, sections, batches };
}
