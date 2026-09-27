// Native M2 model parsing: MD21 containers, SKIN LOD files, SKEL skeletons and
// external ANIM files, plus lazy per-sequence track decoding.
//
// Byte-level semantics follow the M2 format research doc
// (research/rendering/m2-format-and-rendering.md) with loader logic ported from
// the wow.export MIT-licensed loaders (M2Loader, SKELLoader, ANIMLoader, Skin).

export type Vec3 = [number, number, number];
export type Quaternion = [number, number, number, number];
export type TrackValueType = "float32" | "float32x3" | "float32x4" | "quaternion16" | "int16" | "uint8";

/**
 * A byte range that owns animation track payloads. In-file tracks resolve
 * against the MD21 (or SKB1) payload; external sequences resolve the very same
 * descriptor offsets against the ANIM file's payload instead.
 */
export interface Payload {
  bytes: Uint8Array;
  /** Offset of the payload start inside `bytes`; all M2 offsets are relative to it. */
  base: number;
  size: number;
  /** Identifies the payload in error messages, e.g. "FileDataID 42 MD21 payload". */
  label: string;
}

export interface M2Track {
  interpolationMode: number;
  /** -1 for sequence-local tracks, else an index into the global loop durations. */
  globalSequence: number;
  valueType: TrackValueType;
  /** Descriptor arrays of per-sequence M2Arrays, offsets relative to the payload base. */
  timestampsDescriptor: { count: number; offset: number };
  valuesDescriptor: { count: number; offset: number };
  label: string;
}

export interface TrackKeys {
  interpolationMode: number;
  timestamps: number[];
  /** One component list per key, decoded according to the track's value type. */
  values: number[][];
}

export interface M2Sequence {
  index: number;
  animationId: number;
  variationIndex: number;
  durationMs: number;
  moveSpeed: number;
  /** 0x20 = track data in file, 0x40 = alias of another variation. */
  flags: number;
  frequency: number;
  replayMinMs: number;
  replayMaxMs: number;
  blendTimeMs: number;
  variationNext: number;
  aliasNext: number;
}

export interface M2Bone {
  index: number;
  keyBoneId: number;
  flags: number;
  parentIndex: number;
  subMeshId: number;
  boneNameCrc: number;
  pivot: Vec3;
  translation: M2Track;
  rotation: M2Track;
  scale: M2Track;
}

export interface M2Vertex {
  position: Vec3;
  /** Raw weight bytes (sum 255); normalize by /255 when skinning. */
  boneWeights: [number, number, number, number];
  boneIndices: [number, number, number, number];
  normal: Vec3;
  uvs: Array<[number, number]>;
}

export interface M2Texture {
  type: number;
  flags: number;
}

export interface M2Color {
  color: M2Track;
  alpha: M2Track;
}

export interface M2TextureTransform {
  translation: M2Track;
  /** UV rotation stored as four float32 quaternion components. */
  rotation: M2Track;
  scale: M2Track;
}

export interface M2Material {
  flags: number;
  blendMode: number;
}

export interface M2Attachment {
  id: number;
  boneIndex: number;
  flags: number;
  position: Vec3;
  visibility: M2Track;
}

export interface M2AnimationFileReference {
  animationId: number;
  variationIndex: number;
  fileDataId: number;
}

export interface M2Model {
  fileDataId: number;
  version: number;
  globalFlags: number;
  name: string;
  globalSequenceDurationsMs: number[];
  sequences: M2Sequence[];
  /** int16 animation-id -> sequence index table; -1 entries mean "no entry". */
  sequenceLookup: number[];
  bones: M2Bone[];
  keyBoneLookup: number[];
  vertices: M2Vertex[];
  viewCount: number;
  colors: M2Color[];
  textures: M2Texture[];
  textureWeights: M2Track[];
  textureTransforms: M2TextureTransform[];
  replaceableLookup: number[];
  materials: M2Material[];
  boneLookup: number[];
  textureLookup: number[];
  textureUnitLookup: number[];
  textureWeightLookup: number[];
  textureTransformLookup: number[];
  boundingBox: { min: Vec3; max: Vec3 };
  boundingRadius: number;
  collisionBox: { min: Vec3; max: Vec3 };
  collisionRadius: number;
  attachments: M2Attachment[];
  attachmentLookup: number[];
  /** SFID chunk: one entry per view plus trailing LOD entries. */
  skinFileDataIds: number[];
  textureFileDataIds: number[];
  animationFileReferences: M2AnimationFileReference[];
  skeletonFileDataId: number;
  payload: Payload;
  chunkTags: string[];
  unknownChunkTags: string[];
}

export interface M2SkinSection {
  index: number;
  meshPartId: number;
  level: number;
  vertexStart: number;
  vertexCount: number;
  /** Level-extended: level widens only the triangle index start, never the vertex start. */
  indexStart: number;
  indexCount: number;
  boneCount: number;
  boneStart: number;
  boneInfluences: number;
  centerBoneIndex: number;
  centerPosition: Vec3;
  sortCenterPosition: Vec3;
  sortRadius: number;
}

export interface M2SkinBatch {
  index: number;
  flags: number;
  priorityPlane: number;
  shaderId: number;
  sectionIndex: number;
  flags2: number;
  colorIndex: number;
  materialIndex: number;
  materialLayer: number;
  textureCount: number;
  textureComboIndex: number;
  textureCoordComboIndex: number;
  textureWeightComboIndex: number;
  textureTransformComboIndex: number;
}

export interface M2Skin {
  fileDataId: number;
  /** Indices into the M2 vertex array. */
  vertexLookup: number[];
  /** Triangle indices into `vertexLookup`. */
  indices: number[];
  /** Raw 4-byte bone remap records; per-record semantics are undocumented. */
  boneTable: number[][];
  sections: M2SkinSection[];
  batches: M2SkinBatch[];
  shadowBatchCount: number;
}

export interface M2Skel {
  fileDataId: number;
  globalSequenceDurationsMs: number[];
  sequences: M2Sequence[];
  sequenceLookup: number[];
  bones: M2Bone[];
  parentSkeletonFileDataId: number;
  animationFileReferences: M2AnimationFileReference[];
  attachments: M2Attachment[];
  attachmentLookup: number[];
  /** SKB1 payload: the byte owner for skeleton bone tracks. */
  payload: Payload;
  chunkTags: string[];
  unknownChunkTags: string[];
}

export interface AnimFile {
  fileDataId: number;
  payload: Payload;
  chunkTags: string[];
  unknownChunkTags: string[];
}

// Chunks this module actually parses; everything else is retained opaquely and
// reported via unknownChunkTags (TXAC, EXP2, PGD1, BFID, ... included).
const KNOWN_M2_CHUNKS = new Set(["MD21", "SFID", "TXID", "AFID", "SKID"]);
const KNOWN_ANIM_CHUNKS = new Set(["AFM2", "AFSB"]);
const KNOWN_SKEL_CHUNKS = new Set(["SKS1", "SKB1", "SKA1", "SKPD", "AFID"]);
const MAX_ARRAY_COUNT = 1_000_000;

export interface ContainerChunk {
  tag: string;
  size: number;
  payloadOffset: number;
}

function fourCc(bytes: Uint8Array, offset: number): string {
  return String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]);
}

function walkChunks(bytes: Uint8Array, label: string): ContainerChunk[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks: ContainerChunk[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error(`${label}: chunk header is truncated at byte ${offset}.`);
    const tag = fourCc(bytes, offset);
    const size = view.getUint32(offset + 4, true);
    const payloadOffset = offset + 8;
    if (payloadOffset + size > bytes.length) {
      throw new Error(`${label}: chunk ${tag || "?"} is truncated (${size} bytes at ${offset}).`);
    }
    chunks.push({ tag, size, payloadOffset });
    offset = payloadOffset + size;
  }
  if (offset !== bytes.length) throw new Error(`${label}: chunks do not consume the complete file.`);
  return chunks;
}

/** Bounded reader over one payload; every accessor fails with payload context. */
class PayloadReader {
  readonly view: DataView;

  constructor(readonly payload: Payload) {
    this.view = new DataView(payload.bytes.buffer, payload.bytes.byteOffset, payload.bytes.byteLength);
  }

  private require(offset: number, size: number, what: string) {
    if (offset < 0 || offset + size > this.payload.size) {
      throw new Error(`${this.payload.label}: ${what} is outside the payload (offset ${offset}, ${size} bytes).`);
    }
  }

  u8(offset: number, what: string): number {
    this.require(offset, 1, what);
    return this.view.getUint8(this.payload.base + offset);
  }

  i8(offset: number, what: string): number {
    this.require(offset, 1, what);
    return this.view.getInt8(this.payload.base + offset);
  }

  u16(offset: number, what: string): number {
    this.require(offset, 2, what);
    return this.view.getUint16(this.payload.base + offset, true);
  }

  i16(offset: number, what: string): number {
    this.require(offset, 2, what);
    return this.view.getInt16(this.payload.base + offset, true);
  }

  u32(offset: number, what: string): number {
    this.require(offset, 4, what);
    return this.view.getUint32(this.payload.base + offset, true);
  }

  i32(offset: number, what: string): number {
    this.require(offset, 4, what);
    return this.view.getInt32(this.payload.base + offset, true);
  }

  f32(offset: number, what: string): number {
    this.require(offset, 4, what);
    return this.view.getFloat32(this.payload.base + offset, true);
  }

  f32x3(offset: number, what: string): Vec3 {
    return [this.f32(offset, what), this.f32(offset + 4, what), this.f32(offset + 8, what)];
  }

  string(offset: number, byteCount: number, what: string): string {
    this.require(offset, byteCount, what);
    let end = offset;
    while (end < offset + byteCount && this.u8(end, what) !== 0) end += 1;
    return new TextDecoder().decode(this.payload.bytes.subarray(this.payload.base + offset, this.payload.base + end));
  }

  /** Reads an M2Array descriptor and validates the target array bounds. */
  arrayDescriptor(offset: number, stride: number, what: string): { count: number; offset: number } {
    const count = this.u32(offset, `${what} count`);
    const dataOffset = this.u32(offset + 4, `${what} offset`);
    if (count > MAX_ARRAY_COUNT || dataOffset + count * stride > this.payload.size) {
      throw new Error(`${this.payload.label}: ${what} array is outside the payload (count ${count}, offset ${dataOffset}).`);
    }
    return { count, offset: dataOffset };
  }
}

function readTrackDescriptor(reader: PayloadReader, offset: number, label: string, globalLoopCount: number): M2Track {
  const interpolationMode = reader.u16(offset, `${label} interpolation`);
  const globalSequence = reader.i16(offset + 2, `${label} global sequence`);
  const timestampsDescriptor = reader.arrayDescriptor(offset + 4, 8, `${label} timestamps`);
  const valuesDescriptor = reader.arrayDescriptor(offset + 12, 8, `${label} values`);
  if (globalSequence >= 0 && globalSequence >= globalLoopCount) {
    throw new Error(`${reader.payload.label}: ${label} global sequence ${globalSequence} is out of bounds (${globalLoopCount} loops).`);
  }
  return { interpolationMode, globalSequence, valueType: "float32", timestampsDescriptor, valuesDescriptor, label };
}

const TRACK_VALUE_LAYOUT: Record<TrackValueType, { components: number; stride: number; integer?: boolean }> = {
  float32: { components: 1, stride: 4 },
  float32x3: { components: 3, stride: 4 },
  float32x4: { components: 4, stride: 4 },
  quaternion16: { components: 4, stride: 2 },
  int16: { components: 1, stride: 2 },
  uint8: { components: 1, stride: 1 },
};

const trackKeyCache = new WeakMap<M2Track, Map<Payload, Map<number, TrackKeys>>>();

/**
 * Decodes one sequence's keys from the payload that owns the track bytes.
 * Descriptor chains are validated lazily because external sequences resolve
 * the same descriptors against different bytes.
 */
export function readTrackKeys(payload: Payload, track: M2Track, sequenceIndex: number): TrackKeys {
  let byPayload = trackKeyCache.get(track);
  if (!byPayload) {
    byPayload = new Map();
    trackKeyCache.set(track, byPayload);
  }
  let bySequence = byPayload.get(payload);
  if (!bySequence) {
    bySequence = new Map();
    byPayload.set(payload, bySequence);
  }
  const cached = bySequence.get(sequenceIndex);
  if (cached) return cached;

  const slot = track.globalSequence >= 0 ? 0 : sequenceIndex;
  const empty: TrackKeys = { interpolationMode: track.interpolationMode, timestamps: [], values: [] };
  if (slot < 0) return empty;
  if (slot >= track.timestampsDescriptor.count || slot >= track.valuesDescriptor.count) return empty;

  const reader = new PayloadReader(payload);
  const timestampsAt = track.timestampsDescriptor.offset + slot * 8;
  const valuesAt = track.valuesDescriptor.offset + slot * 8;
  const timestamps = reader.arrayDescriptor(timestampsAt, 4, `${track.label} timestamps`);
  const values = reader.arrayDescriptor(valuesAt, TRACK_VALUE_LAYOUT[track.valueType].stride, `${track.label} values`);
  if (timestamps.count !== values.count) {
    throw new Error(`${payload.label}: ${track.label} has ${timestamps.count} timestamps but ${values.count} values.`);
  }
  if (timestamps.count > 0 && track.interpolationMode !== 0 && track.interpolationMode !== 1) {
    throw new Error(
      `${payload.label}: ${track.label} interpolation mode ${track.interpolationMode} is not implemented; only step (0) and linear (1) are supported.`,
    );
  }

  const layout = TRACK_VALUE_LAYOUT[track.valueType];
  const decoded: TrackKeys = { interpolationMode: track.interpolationMode, timestamps: [], values: [] };
  for (let index = 0; index < timestamps.count; index += 1) {
    decoded.timestamps.push(reader.u32(timestamps.offset + index * 4, `${track.label} timestamp ${index}`));
    const components: number[] = [];
    for (let component = 0; component < layout.components; component += 1) {
      const at = values.offset + (index * layout.components + component) * layout.stride;
      if (track.valueType === "quaternion16") components.push(reader.u16(at, `${track.label} value ${index}`));
      else if (track.valueType === "int16") components.push(reader.i16(at, `${track.label} value ${index}`));
      else if (track.valueType === "uint8") components.push(reader.u8(at, `${track.label} value ${index}`));
      else components.push(reader.f32(at, `${track.label} value ${index}`));
    }
    decoded.values.push(components);
  }
  bySequence.set(sequenceIndex, decoded);
  return decoded;
}

function readSequences(reader: PayloadReader, descriptor: { count: number; offset: number }): M2Sequence[] {
  const sequences: M2Sequence[] = [];
  for (let index = 0; index < descriptor.count; index += 1) {
    const at = descriptor.offset + index * 0x40;
    sequences.push({
      index,
      animationId: reader.u16(at, `sequence ${index} animation id`),
      variationIndex: reader.u16(at + 2, `sequence ${index} variation`),
      durationMs: reader.u32(at + 4, `sequence ${index} duration`),
      moveSpeed: reader.f32(at + 8, `sequence ${index} move speed`),
      flags: reader.u32(at + 0xc, `sequence ${index} flags`),
      frequency: reader.i16(at + 0x10, `sequence ${index} frequency`),
      replayMinMs: reader.u32(at + 0x14, `sequence ${index} replay min`),
      replayMaxMs: reader.u32(at + 0x18, `sequence ${index} replay max`),
      blendTimeMs: reader.u32(at + 0x1c, `sequence ${index} blend time`),
      variationNext: reader.i16(at + 0x3c, `sequence ${index} variation next`),
      aliasNext: reader.u16(at + 0x3e, `sequence ${index} alias next`),
    });
  }
  return sequences;
}

function readI16Lookup(reader: PayloadReader, descriptor: { count: number; offset: number }, what: string): number[] {
  const values: number[] = [];
  for (let index = 0; index < descriptor.count; index += 1) {
    values.push(reader.i16(descriptor.offset + index * 2, `${what} entry ${index}`));
  }
  return values;
}

function readU16Lookup(reader: PayloadReader, descriptor: { count: number; offset: number }, what: string): number[] {
  const values: number[] = [];
  for (let index = 0; index < descriptor.count; index += 1) {
    values.push(reader.u16(descriptor.offset + index * 2, `${what} entry ${index}`));
  }
  return values;
}

function readU32Lookup(reader: PayloadReader, descriptor: { count: number; offset: number }, what: string): number[] {
  const values: number[] = [];
  for (let index = 0; index < descriptor.count; index += 1) {
    values.push(reader.u32(descriptor.offset + index * 4, `${what} entry ${index}`));
  }
  return values;
}

function validateBoneParents(bones: M2Bone[], label: string) {
  for (const bone of bones) {
    if (bone.parentIndex < -1 || bone.parentIndex >= bones.length) {
      throw new Error(`${label}: bone ${bone.index} parent ${bone.parentIndex} is outside the bone array.`);
    }
  }
  const visitedRoots = new Uint8Array(bones.length);
  for (const bone of bones) {
    if (visitedRoots[bone.index]) continue;
    const path = new Set<number>();
    let current: M2Bone | undefined = bone;
    while (current && current.parentIndex !== -1 && !visitedRoots[current.index]) {
      if (path.has(current.index)) {
        throw new Error(`${label}: bone ${current.index} participates in a parent cycle.`);
      }
      path.add(current.index);
      current = bones[current.parentIndex];
    }
    for (const index of path) visitedRoots[index] = 1;
  }
}

function readBones(
  reader: PayloadReader,
  descriptor: { count: number; offset: number },
  globalLoopCount: number,
): M2Bone[] {
  const bones: M2Bone[] = [];
  for (let index = 0; index < descriptor.count; index += 1) {
    const at = descriptor.offset + index * 0x58;
    const label = `bone ${index}`;
    const translation = readTrackDescriptor(reader, at + 0x10, `${label} translation`, globalLoopCount);
    translation.valueType = "float32x3";
    const rotation = readTrackDescriptor(reader, at + 0x24, `${label} rotation`, globalLoopCount);
    rotation.valueType = "quaternion16";
    const scale = readTrackDescriptor(reader, at + 0x38, `${label} scale`, globalLoopCount);
    scale.valueType = "float32x3";
    bones.push({
      index,
      keyBoneId: reader.i32(at, `${label} key bone id`),
      flags: reader.u32(at + 4, `${label} flags`),
      parentIndex: reader.i16(at + 8, `${label} parent`),
      subMeshId: reader.u16(at + 10, `${label} submesh`),
      boneNameCrc: reader.u32(at + 12, `${label} name crc`),
      translation,
      rotation,
      scale,
      pivot: reader.f32x3(at + 0x4c, `${label} pivot`),
    });
  }
  validateBoneParents(bones, reader.payload.label);
  return bones;
}

function readAttachments(
  reader: PayloadReader,
  descriptor: { count: number; offset: number },
  globalLoopCount: number,
): M2Attachment[] {
  const attachments: M2Attachment[] = [];
  for (let index = 0; index < descriptor.count; index += 1) {
    const at = descriptor.offset + index * 0x28;
    const visibility = readTrackDescriptor(reader, at + 20, `attachment ${index} visibility`, globalLoopCount);
    visibility.valueType = "uint8";
    attachments.push({
      id: reader.u32(at, `attachment ${index} id`),
      boneIndex: reader.u16(at + 4, `attachment ${index} bone`),
      flags: reader.u16(at + 6, `attachment ${index} flags`),
      position: reader.f32x3(at + 8, `attachment ${index} position`),
      visibility,
    });
  }
  return attachments;
}

function readAnimationReferences(reader: PayloadReader, chunk: ContainerChunk): M2AnimationFileReference[] {
  const references: M2AnimationFileReference[] = [];
  for (let offset = 0; offset + 8 <= chunk.size; offset += 8) {
    references.push({
      animationId: reader.u16(chunk.payloadOffset - reader.payload.base + offset, "AFID animation id"),
      variationIndex: reader.u16(chunk.payloadOffset - reader.payload.base + offset + 2, "AFID variation"),
      fileDataId: reader.u32(chunk.payloadOffset - reader.payload.base + offset + 4, "AFID file data id"),
    });
  }
  return references;
}

export function parseM2File(source: ArrayBuffer, fileDataId: number): M2Model {
  const bytes = new Uint8Array(source);
  const label = `FileDataID ${fileDataId}`;
  const chunks = walkChunks(bytes, label);
  const md21 = chunks.find((chunk) => chunk.tag === "MD21");
  if (!md21 || md21.size < 0x138) throw new Error(`${label}: MD21 payload is missing or too short (${md21?.size ?? 0} bytes).`);

  const payload: Payload = { bytes, base: md21.payloadOffset, size: md21.size, label: `${label} MD21 payload` };
  const reader = new PayloadReader(payload);
  const magic = fourCc(bytes, md21.payloadOffset);
  if (magic !== "MD20") throw new Error(`${label}: MD21 payload does not begin with MD20 (found "${magic}").`);
  const version = reader.u32(4, "version");
  if (version !== 272 && version !== 274) {
    throw new Error(`${label}: M2 version ${version} is not supported; only 272 and 274 are.`);
  }

  const nameDescriptor = reader.arrayDescriptor(0x08, 1, "name");
  const globalLoops = reader.arrayDescriptor(0x14, 4, "global loops");
  const sequencesDescriptor = reader.arrayDescriptor(0x1c, 0x40, "sequence");
  const sequenceLookupDescriptor = reader.arrayDescriptor(0x24, 2, "sequence lookup");
  const bonesDescriptor = reader.arrayDescriptor(0x2c, 0x58, "bone");
  const keyBoneLookupDescriptor = reader.arrayDescriptor(0x34, 4, "key bone lookup");
  const verticesDescriptor = reader.arrayDescriptor(0x3c, 0x30, "vertex");
  const colorsDescriptor = reader.arrayDescriptor(0x48, 0x28, "color");
  const texturesDescriptor = reader.arrayDescriptor(0x50, 16, "texture");
  const weightsDescriptor = reader.arrayDescriptor(0x58, 20, "texture weight");
  const transformsDescriptor = reader.arrayDescriptor(0x60, 0x3c, "texture transform");
  const replaceableDescriptor = reader.arrayDescriptor(0x68, 2, "replaceable lookup");
  const materialsDescriptor = reader.arrayDescriptor(0x70, 4, "material");
  const boneLookupDescriptor = reader.arrayDescriptor(0x78, 2, "bone lookup");
  const textureLookupDescriptor = reader.arrayDescriptor(0x80, 2, "texture lookup");
  const textureUnitLookupDescriptor = reader.arrayDescriptor(0x88, 2, "texture unit lookup");
  const textureWeightLookupDescriptor = reader.arrayDescriptor(0x90, 2, "texture weight lookup");
  const textureTransformLookupDescriptor = reader.arrayDescriptor(0x98, 2, "texture transform lookup");
  const attachmentsDescriptor = reader.arrayDescriptor(0xf0, 0x28, "attachment");
  const attachmentLookupDescriptor = reader.arrayDescriptor(0xf8, 2, "attachment lookup");

  const globalSequenceDurationsMs = readU32Lookup(reader, globalLoops, "global loop");
  const sequences = readSequences(reader, sequencesDescriptor);
  const bones = readBones(reader, bonesDescriptor, globalSequenceDurationsMs.length);
  const sequenceLookup = readI16Lookup(reader, sequenceLookupDescriptor, "sequence lookup");

  const vertices: M2Vertex[] = [];
  for (let index = 0; index < verticesDescriptor.count; index += 1) {
    const at = verticesDescriptor.offset + index * 0x30;
    const uv0: [number, number] = [reader.f32(at + 32, `vertex ${index} u`), reader.f32(at + 36, `vertex ${index} v`)];
    const uv1: [number, number] = [reader.f32(at + 40, `vertex ${index} u2`), reader.f32(at + 44, `vertex ${index} v2`)];
    vertices.push({
      position: reader.f32x3(at, `vertex ${index} position`),
      boneWeights: [
        reader.u8(at + 12, `vertex ${index} weight 0`), reader.u8(at + 13, `vertex ${index} weight 1`),
        reader.u8(at + 14, `vertex ${index} weight 2`), reader.u8(at + 15, `vertex ${index} weight 3`),
      ],
      boneIndices: [
        reader.u8(at + 16, `vertex ${index} bone 0`), reader.u8(at + 17, `vertex ${index} bone 1`),
        reader.u8(at + 18, `vertex ${index} bone 2`), reader.u8(at + 19, `vertex ${index} bone 3`),
      ],
      normal: reader.f32x3(at + 20, `vertex ${index} normal`),
      uvs: [uv0, uv1],
    });
  }

  const colors: M2Color[] = [];
  for (let index = 0; index < colorsDescriptor.count; index += 1) {
    const at = colorsDescriptor.offset + index * 0x28;
    const color = readTrackDescriptor(reader, at, `color ${index}`, globalSequenceDurationsMs.length);
    color.valueType = "float32x3";
    const alpha = readTrackDescriptor(reader, at + 0x14, `color ${index} alpha`, globalSequenceDurationsMs.length);
    alpha.valueType = "int16";
    colors.push({ color, alpha });
  }

  const textures: M2Texture[] = [];
  for (let index = 0; index < texturesDescriptor.count; index += 1) {
    const at = texturesDescriptor.offset + index * 16;
    textures.push({
      type: reader.u32(at, `texture ${index} type`),
      flags: reader.u32(at + 4, `texture ${index} flags`),
    });
  }

  const textureWeights: M2Track[] = [];
  for (let index = 0; index < weightsDescriptor.count; index += 1) {
    const weight = readTrackDescriptor(reader, weightsDescriptor.offset + index * 20, `texture weight ${index}`, globalSequenceDurationsMs.length);
    weight.valueType = "int16";
    textureWeights.push(weight);
  }

  const textureTransforms: M2TextureTransform[] = [];
  for (let index = 0; index < transformsDescriptor.count; index += 1) {
    const at = transformsDescriptor.offset + index * 0x3c;
    const translation = readTrackDescriptor(reader, at, `texture transform ${index} translation`, globalSequenceDurationsMs.length);
    translation.valueType = "float32x3";
    const rotation = readTrackDescriptor(reader, at + 0x14, `texture transform ${index} rotation`, globalSequenceDurationsMs.length);
    rotation.valueType = "float32x4";
    const scale = readTrackDescriptor(reader, at + 0x28, `texture transform ${index} scale`, globalSequenceDurationsMs.length);
    scale.valueType = "float32x3";
    textureTransforms.push({ translation, rotation, scale });
  }

  const materials: M2Material[] = [];
  for (let index = 0; index < materialsDescriptor.count; index += 1) {
    const at = materialsDescriptor.offset + index * 4;
    materials.push({
      flags: reader.u16(at, `material ${index} flags`),
      blendMode: reader.u16(at + 2, `material ${index} blend`),
    });
  }

  const boundingBoxMin = reader.f32x3(0xa0, "bounding box min");
  const boundingBoxMax = reader.f32x3(0xac, "bounding box max");

  const model: M2Model = {
    fileDataId,
    version,
    globalFlags: reader.u32(0x10, "global flags"),
    name: reader.string(nameDescriptor.offset, nameDescriptor.count, "name"),
    globalSequenceDurationsMs,
    sequences,
    sequenceLookup,
    bones,
    keyBoneLookup: readU32Lookup(reader, keyBoneLookupDescriptor, "key bone"),
    vertices,
    viewCount: reader.u32(0x44, "view count"),
    colors,
    textures,
    textureWeights,
    textureTransforms,
    replaceableLookup: readI16Lookup(reader, replaceableDescriptor, "replaceable lookup"),
    materials,
    boneLookup: readU16Lookup(reader, boneLookupDescriptor, "bone lookup"),
    textureLookup: readU16Lookup(reader, textureLookupDescriptor, "texture lookup"),
    textureUnitLookup: readU16Lookup(reader, textureUnitLookupDescriptor, "texture unit lookup"),
    textureWeightLookup: readU16Lookup(reader, textureWeightLookupDescriptor, "texture weight lookup"),
    textureTransformLookup: readU16Lookup(reader, textureTransformLookupDescriptor, "texture transform lookup"),
    boundingBox: { min: boundingBoxMin, max: boundingBoxMax },
    boundingRadius: reader.f32(0xb8, "bounding radius"),
    collisionBox: { min: reader.f32x3(0xbc, "collision box min"), max: reader.f32x3(0xc8, "collision box max") },
    collisionRadius: reader.f32(0xd4, "collision radius"),
    attachments: readAttachments(reader, attachmentsDescriptor, globalSequenceDurationsMs.length),
    attachmentLookup: readI16Lookup(reader, attachmentLookupDescriptor, "attachment lookup"),
    skinFileDataIds: [],
    textureFileDataIds: [],
    animationFileReferences: [],
    skeletonFileDataId: 0,
    payload,
    chunkTags: chunks.map((chunk) => chunk.tag),
    unknownChunkTags: chunks.filter((chunk) => !KNOWN_M2_CHUNKS.has(chunk.tag)).map((chunk) => chunk.tag),
  };

  for (const chunk of chunks) {
    // Chunk payload offsets are absolute in the file; the reader is payload-relative.
    const chunkReader = new PayloadReader({ ...payload, base: 0, size: bytes.length, label: payload.label });
    if (chunk.tag === "SFID") model.skinFileDataIds = readU32Lookup(chunkReader, { count: chunk.size / 4, offset: chunk.payloadOffset }, "SFID");
    if (chunk.tag === "TXID") model.textureFileDataIds = readU32Lookup(chunkReader, { count: chunk.size / 4, offset: chunk.payloadOffset }, "TXID");
    if (chunk.tag === "AFID") model.animationFileReferences = readAnimationReferences(chunkReader, chunk);
    if (chunk.tag === "SKID" && chunk.size >= 4) {
      model.skeletonFileDataId = chunkReader.u32(chunk.payloadOffset, "SKID");
    }
  }
  return model;
}

export function parseSkinFile(source: ArrayBuffer, fileDataId: number): M2Skin {
  const bytes = new Uint8Array(source);
  const label = `FileDataID ${fileDataId}`;
  if (bytes.length < 0x38 || fourCc(bytes, 0) !== "SKIN") {
    throw new Error(`${label}: SKIN magic is missing or truncated.`);
  }
  const payload: Payload = { bytes, base: 0, size: bytes.length, label: `${label} SKIN` };
  const reader = new PayloadReader(payload);
  const vertexLookupDescriptor = reader.arrayDescriptor(4, 2, "vertex lookup");
  const indicesDescriptor = reader.arrayDescriptor(12, 2, "triangle indices");
  const bonesDescriptor = reader.arrayDescriptor(20, 4, "bone remap");
  const sectionsDescriptor = reader.arrayDescriptor(28, 0x30, "sections");
  const batchesDescriptor = reader.arrayDescriptor(36, 0x18, "batches");
  const shadowBatchesDescriptor = reader.arrayDescriptor(48, 12, "shadow batches");

  const vertexLookup = readU16Lookup(reader, vertexLookupDescriptor, "vertex lookup");
  const indices = readU16Lookup(reader, indicesDescriptor, "triangle index");

  const boneTable: number[][] = [];
  for (let index = 0; index < bonesDescriptor.count; index += 1) {
    const at = bonesDescriptor.offset + index * 4;
    boneTable.push([
      reader.u8(at, `bone remap ${index} byte 0`), reader.u8(at + 1, `bone remap ${index} byte 1`),
      reader.u8(at + 2, `bone remap ${index} byte 2`), reader.u8(at + 3, `bone remap ${index} byte 3`),
    ]);
  }

  const sections: M2SkinSection[] = [];
  for (let index = 0; index < sectionsDescriptor.count; index += 1) {
    const at = sectionsDescriptor.offset + index * 0x30;
    const level = reader.u16(at + 2, `section ${index} level`);
    const indexStart = reader.u16(at + 8, `section ${index} index start`) + level * 65536;
    const indexCount = reader.u16(at + 10, `section ${index} index count`);
    sections.push({
      index,
      meshPartId: reader.u16(at, `section ${index} mesh part id`),
      level,
      vertexStart: reader.u16(at + 4, `section ${index} vertex start`),
      vertexCount: reader.u16(at + 6, `section ${index} vertex count`),
      indexStart,
      indexCount,
      boneCount: reader.u16(at + 12, `section ${index} bone count`),
      boneStart: reader.u16(at + 14, `section ${index} bone start`),
      boneInfluences: reader.u16(at + 16, `section ${index} bone influences`),
      centerBoneIndex: reader.u16(at + 18, `section ${index} center bone`),
      centerPosition: reader.f32x3(at + 20, `section ${index} center`),
      sortCenterPosition: reader.f32x3(at + 32, `section ${index} sort center`),
      sortRadius: reader.f32(at + 44, `section ${index} sort radius`),
    });
  }

  const batches: M2SkinBatch[] = [];
  for (let index = 0; index < batchesDescriptor.count; index += 1) {
    const at = batchesDescriptor.offset + index * 0x18;
    batches.push({
      index,
      flags: reader.u8(at, `batch ${index} flags`),
      priorityPlane: reader.i8(at + 1, `batch ${index} priority plane`),
      shaderId: reader.u16(at + 2, `batch ${index} shader`),
      sectionIndex: reader.u16(at + 4, `batch ${index} section`),
      flags2: reader.u16(at + 6, `batch ${index} flags2`),
      colorIndex: reader.i16(at + 8, `batch ${index} color`),
      materialIndex: reader.u16(at + 10, `batch ${index} material`),
      materialLayer: reader.u16(at + 12, `batch ${index} material layer`),
      textureCount: reader.u16(at + 14, `batch ${index} texture count`),
      textureComboIndex: reader.u16(at + 16, `batch ${index} texture combo`),
      textureCoordComboIndex: reader.u16(at + 18, `batch ${index} texture coord combo`),
      textureWeightComboIndex: reader.u16(at + 20, `batch ${index} texture weight combo`),
      textureTransformComboIndex: reader.u16(at + 22, `batch ${index} texture transform combo`),
    });
  }

  for (let index = 0; index < indices.length; index += 1) {
    if (indices[index] >= vertexLookup.length) {
      throw new Error(`${label}: triangle index ${index} is outside the skin vertex lookup (${indices[index]} >= ${vertexLookup.length}).`);
    }
  }
  for (const section of sections) {
    if (section.vertexStart + section.vertexCount > vertexLookup.length
      || section.indexStart + section.indexCount > indices.length) {
      throw new Error(`${label}: section ${section.index} vertex or triangle range is outside the skin arrays.`);
    }
  }

  return {
    fileDataId,
    vertexLookup,
    indices,
    boneTable,
    sections,
    batches,
    shadowBatchCount: shadowBatchesDescriptor.count,
  };
}

export function parseAnimFile(source: ArrayBuffer, fileDataId: number): AnimFile {
  const bytes = new Uint8Array(source);
  const label = `FileDataID ${fileDataId}`;
  if (bytes.length === 0) throw new Error(`${label}: ANIM file is empty.`);
  const head = fourCc(bytes, 0);
  if (head !== "AFM2" && head !== "AFSB") {
    // Raw animation file: the whole file is the track payload.
    return {
      fileDataId,
      payload: { bytes, base: 0, size: bytes.length, label: `${label} ANIM payload` },
      chunkTags: [],
      unknownChunkTags: [],
    };
  }
  const chunks = walkChunks(bytes, label);
  const owner = chunks.find((chunk) => chunk.tag === "AFSB") ?? chunks.find((chunk) => chunk.tag === "AFM2");
  if (!owner) throw new Error(`${label}: chunked ANIM file has neither AFSB nor AFM2 bytes.`);
  return {
    fileDataId,
    payload: { bytes, base: owner.payloadOffset, size: owner.size, label: `${label} ANIM payload` },
    chunkTags: chunks.map((chunk) => chunk.tag),
    unknownChunkTags: chunks.filter((chunk) => !KNOWN_ANIM_CHUNKS.has(chunk.tag)).map((chunk) => chunk.tag),
  };
}

export function parseSkelFile(source: ArrayBuffer, fileDataId: number): M2Skel {
  const bytes = new Uint8Array(source);
  const label = `FileDataID ${fileDataId}`;
  const chunks = walkChunks(bytes, label);
  const sks1 = chunks.find((chunk) => chunk.tag === "SKS1");
  const skb1 = chunks.find((chunk) => chunk.tag === "SKB1");
  if (!skb1) throw new Error(`${label}: SKEL file is missing the SKB1 bone chunk.`);
  if (!sks1) throw new Error(`${label}: SKEL file is missing the SKS1 sequence chunk.`);

  const filePayload: Payload = { bytes, base: 0, size: bytes.length, label };
  const fileReader = new PayloadReader(filePayload);

  const sequencePayload: Payload = { bytes, base: sks1.payloadOffset, size: sks1.size, label: `${label} SKS1 payload` };
  const sequenceReader = new PayloadReader(sequencePayload);
  const globalLoops = sequenceReader.arrayDescriptor(0, 4, "global loops");
  const globalSequenceDurationsMs = readU32Lookup(sequenceReader, globalLoops, "global loop");
  const sequences = readSequences(sequenceReader, sequenceReader.arrayDescriptor(8, 0x40, "sequence"));
  const sequenceLookup = readI16Lookup(sequenceReader, sequenceReader.arrayDescriptor(0x10, 2, "sequence lookup"), "sequence lookup");

  const bonePayload: Payload = { bytes, base: skb1.payloadOffset, size: skb1.size, label: `${label} SKB1 payload` };
  const boneReader = new PayloadReader(bonePayload);
  const bones = readBones(boneReader, boneReader.arrayDescriptor(0, 0x58, "bone"), globalSequenceDurationsMs.length);

  const ska1 = chunks.find((chunk) => chunk.tag === "SKA1");
  let attachments: M2Attachment[] = [];
  let attachmentLookup: number[] = [];
  if (ska1) {
    const attachmentPayload: Payload = { bytes, base: ska1.payloadOffset, size: ska1.size, label: `${label} SKA1 payload` };
    const attachmentReader = new PayloadReader(attachmentPayload);
    attachments = readAttachments(attachmentReader, attachmentReader.arrayDescriptor(0, 0x28, "attachment"), globalSequenceDurationsMs.length);
    attachmentLookup = readI16Lookup(attachmentReader, attachmentReader.arrayDescriptor(8, 2, "attachment lookup"), "attachment lookup");
  }

  const skpd = chunks.find((chunk) => chunk.tag === "SKPD");
  const parentSkeletonFileDataId = skpd ? fileReader.u32(skpd.payloadOffset, "SKPD parent") : 0;
  const afid = chunks.find((chunk) => chunk.tag === "AFID");
  const animationFileReferences = afid ? readAnimationReferences(fileReader, afid) : [];

  return {
    fileDataId,
    globalSequenceDurationsMs,
    sequences,
    sequenceLookup,
    bones,
    parentSkeletonFileDataId,
    animationFileReferences,
    attachments,
    attachmentLookup,
    payload: bonePayload,
    chunkTags: chunks.map((chunk) => chunk.tag),
    unknownChunkTags: chunks.filter((chunk) => !KNOWN_SKEL_CHUNKS.has(chunk.tag)).map((chunk) => chunk.tag),
  };
}
