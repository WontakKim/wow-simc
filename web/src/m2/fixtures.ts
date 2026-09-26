// Synthetic byte-level builders for the native M2 loader tests.
// Each builder writes real on-disk layout (chunk headers, MD20 record strides,
// M2Track descriptor chains) so tests exercise the parser's byte arithmetic.

export type Vec3 = [number, number, number];

export interface FixtureKeySet {
  timestamps: number[];
  values: number[][];
}

export interface FixtureTrack {
  interpolation?: number;
  globalSequence?: number;
  /** One entry per sequence; missing or empty entries mean "no keys". */
  sequences: Array<FixtureKeySet | undefined>;
}

export interface FixtureBone {
  keyBoneId?: number;
  flags?: number;
  parent?: number;
  subMeshId?: number;
  boneNameCrc?: number;
  pivot?: Vec3;
  translation?: FixtureTrack;
  rotation?: FixtureTrack;
  scale?: FixtureTrack;
}

export interface FixtureSequence {
  animationId: number;
  variationIndex?: number;
  durationMs?: number;
  flags?: number;
  variationNext?: number;
  aliasNext?: number;
}

export interface FixtureVertex {
  position?: Vec3;
  boneWeights?: [number, number, number, number];
  boneIndices?: [number, number, number, number];
  normal?: Vec3;
  uvs?: Array<[number, number]>;
}

export interface FixtureAttachment {
  id: number;
  bone?: number;
  flags?: number;
  position?: Vec3;
}

export interface FixtureSection {
  meshPartId?: number;
  level?: number;
  vertexStart?: number;
  vertexCount?: number;
  indexStart?: number;
  indexCount?: number;
  boneCount?: number;
  boneStart?: number;
}

export interface FixtureBatch {
  flags?: number;
  priorityPlane?: number;
  shaderId?: number;
  sectionIndex?: number;
  flags2?: number;
  colorIndex?: number;
  materialIndex?: number;
  materialLayer?: number;
  textureCount?: number;
  textureComboIndex?: number;
  textureCoordComboIndex?: number;
  textureWeightComboIndex?: number;
  textureTransformComboIndex?: number;
}

type ValueType = "float32" | "float32x3" | "float32x4" | "quaternion16" | "int16";

const VALUE_SIZES: Record<ValueType, { components: number; stride: number }> = {
  float32: { components: 1, stride: 4 },
  float32x3: { components: 3, stride: 4 },
  float32x4: { components: 4, stride: 4 },
  quaternion16: { components: 4, stride: 2 },
  int16: { components: 1, stride: 2 },
};

class PayloadWriter {
  readonly view: DataView;

  /** End of written data; builders slice payloads up to this offset. */
  nextOffset: number;

  constructor(
    readonly buffer: ArrayBuffer,
    firstFreeOffset: number,
  ) {
    this.view = new DataView(buffer);
    this.nextOffset = Math.ceil(firstFreeOffset / 16) * 16;
  }

  alloc(size: number): number {
    const offset = this.nextOffset;
    this.nextOffset = (offset + size + 15) & ~15;
    if (this.nextOffset > this.buffer.byteLength) {
      throw new Error(`fixture payload overflow: need ${this.nextOffset} bytes, have ${this.buffer.byteLength}`);
    }
    return offset;
  }

  array(offset: number, count: number, dataOffset: number) {
    this.view.setUint32(offset, count, true);
    this.view.setUint32(offset + 4, dataOffset, true);
  }

  writeTrack(offset: number, track: FixtureTrack | undefined, sequenceCount: number, valueType: ValueType) {
    this.view.setUint16(offset, track?.interpolation ?? 0, true);
    this.view.setInt16(offset + 2, track?.globalSequence ?? -1, true);
    const timestampDescriptors = this.alloc(sequenceCount * 8);
    const valueDescriptors = this.alloc(sequenceCount * 8);
    this.array(offset + 4, sequenceCount, timestampDescriptors);
    this.array(offset + 12, sequenceCount, valueDescriptors);
    if (!track) return;
    const layout = VALUE_SIZES[valueType];
    track.sequences.forEach((keySet, index) => {
      if (!keySet || keySet.timestamps.length === 0) return;
      const { timestamps, values } = keySet;
      if (values.length !== timestamps.length) {
        throw new Error(`fixture track sequence ${index} has ${timestamps.length} timestamps but ${values.length} values`);
      }
      const timestampOffset = this.alloc(timestamps.length * 4);
      const valueOffset = this.alloc(values.length * layout.components * layout.stride);
      this.array(timestampDescriptors + index * 8, timestamps.length, timestampOffset);
      this.array(valueDescriptors + index * 8, values.length, valueOffset);
      timestamps.forEach((timestamp, i) => this.view.setUint32(timestampOffset + i * 4, timestamp, true));
      values.forEach((value, i) => {
        if (value.length !== layout.components) {
          throw new Error(`fixture key ${i} has ${value.length} components, expected ${layout.components} for ${valueType}`);
        }
        value.forEach((component, c) => {
          const at = valueOffset + (i * layout.components + c) * layout.stride;
          if (valueType === "quaternion16") this.view.setUint16(at, component, true);
          else if (valueType === "int16") this.view.setInt16(at, component, true);
          else this.view.setFloat32(at, component, true);
        });
      });
    });
  }
}

function assembleChunks(chunks: Array<{ tag: string; payload: Uint8Array | ArrayBuffer }>): ArrayBuffer {
  const total = chunks.reduce((sum, chunk) => sum + 8 + chunk.payload.byteLength, 0);
  const file = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    file.set(new TextEncoder().encode(chunk.tag), offset);
    new DataView(file.buffer).setUint32(offset + 4, chunk.payload.byteLength, true);
    file.set(chunk.payload instanceof Uint8Array ? chunk.payload : new Uint8Array(chunk.payload), offset + 8);
    offset += 8 + chunk.payload.byteLength;
  }
  return file.buffer;
}

export interface M2FixtureOptions {
  fileDataId?: number;
  version?: number;
  globalFlags?: number;
  name?: string;
  globalSequences?: number[];
  sequences?: FixtureSequence[];
  sequenceLookup?: number[];
  bones?: FixtureBone[];
  vertices?: FixtureVertex[];
  viewCount?: number;
  textures?: Array<{ type?: number; flags?: number }>;
  materials?: Array<{ flags?: number; blendMode?: number }>;
  textureTransforms?: Array<{ translation?: FixtureTrack; rotation?: FixtureTrack; scale?: FixtureTrack }>;
  replaceableLookup?: number[];
  boneLookup?: number[];
  textureLookup?: number[];
  textureUnitLookup?: number[];
  textureWeightLookup?: number[];
  textureTransformLookup?: number[];
  attachments?: FixtureAttachment[];
  attachmentLookup?: number[];
  boundingBox?: [number, number, number, number, number, number];
  boundingRadius?: number;
  skinFileDataIds?: number[];
  textureFileDataIds?: number[];
  animationFiles?: Array<{ animationId: number; variationIndex: number; fileDataId: number }>;
  skeletonFileDataId?: number;
  extraChunks?: Array<{ tag: string; payload?: Uint8Array | ArrayBuffer }>;
}

/** Builds a complete MD21-container M2 file from typed fixture records. */
export function buildM2ModelFixture(options: M2FixtureOptions = {}): ArrayBuffer {
  const buffer = new ArrayBuffer(0x10000);
  const writer = new PayloadWriter(buffer, 0x138);
  const view = writer.view;
  const sequences = options.sequences ?? [];
  const bones = options.bones ?? [];
  const vertices = options.vertices ?? [];
  const textures = options.textures ?? [];
  const materials = options.materials ?? [];
  const textureTransforms = options.textureTransforms ?? [];
  const attachments = options.attachments ?? [];

  // Track descriptor tables get at least one slot so key sets can be read at
  // sequence index 0 even in fixtures that declare no sequences.
  const trackSlots = Math.max(1, sequences.length);
  const encoder = new TextEncoder();
  view.setUint32(0, 0x3032444d, true); // "MD20"
  view.setUint32(4, options.version ?? 274, true);
  const nameBytes = encoder.encode(options.name ?? "test.m2");
  const nameOffset = writer.alloc(nameBytes.length);
  new Uint8Array(buffer, nameOffset, nameBytes.length).set(nameBytes);
  writer.array(0x08, nameBytes.length, nameOffset);
  view.setUint32(0x10, options.globalFlags ?? 0x202080, true);

  const globalSequences = options.globalSequences ?? [];
  const globalSequenceOffset = writer.alloc(globalSequences.length * 4);
  globalSequences.forEach((duration, i) => view.setUint32(globalSequenceOffset + i * 4, duration, true));
  writer.array(0x14, globalSequences.length, globalSequenceOffset);

  const sequenceOffset = writer.alloc(sequences.length * 0x40);
  sequences.forEach((sequence, i) => {
    const at = sequenceOffset + i * 0x40;
    view.setUint16(at, sequence.animationId, true);
    view.setUint16(at + 2, sequence.variationIndex ?? 0, true);
    view.setUint32(at + 4, sequence.durationMs ?? 1000, true);
    view.setFloat32(at + 8, 1, true);
    view.setUint32(at + 0xc, sequence.flags ?? 0x20, true);
    view.setInt16(at + 0x3c, sequence.variationNext ?? -1, true);
    view.setUint16(at + 0x3e, sequence.aliasNext ?? 0, true);
  });
  writer.array(0x1c, sequences.length, sequenceOffset);

  const lookup = options.sequenceLookup ?? [];
  const lookupOffset = writer.alloc(lookup.length * 2);
  lookup.forEach((value, i) => view.setInt16(lookupOffset + i * 2, value, true));
  writer.array(0x24, lookup.length, lookupOffset);

  const boneOffset = writer.alloc(bones.length * 0x58);
  bones.forEach((bone, i) => {
    const at = boneOffset + i * 0x58;
    view.setInt32(at, bone.keyBoneId ?? -1, true);
    view.setUint32(at + 4, bone.flags ?? 0, true);
    view.setInt16(at + 8, bone.parent ?? -1, true);
    view.setUint16(at + 10, bone.subMeshId ?? 0, true);
    view.setUint32(at + 12, bone.boneNameCrc ?? 0, true);
    writer.writeTrack(at + 0x10, bone.translation, trackSlots, "float32x3");
    writer.writeTrack(at + 0x24, bone.rotation, trackSlots, "quaternion16");
    writer.writeTrack(at + 0x38, bone.scale, trackSlots, "float32x3");
    const pivot = bone.pivot ?? [0, 0, 0];
    view.setFloat32(at + 0x4c, pivot[0], true);
    view.setFloat32(at + 0x50, pivot[1], true);
    view.setFloat32(at + 0x54, pivot[2], true);
  });
  writer.array(0x2c, bones.length, boneOffset);
  const keyBoneOffset = writer.alloc(bones.length * 4);
  bones.forEach((_, i) => view.setUint32(keyBoneOffset + i * 4, i, true));
  writer.array(0x34, bones.length, keyBoneOffset);

  const vertexOffset = writer.alloc(vertices.length * 0x30);
  vertices.forEach((vertex, i) => {
    const at = vertexOffset + i * 0x30;
    const position = vertex.position ?? [0, 0, 0];
    view.setFloat32(at, position[0], true);
    view.setFloat32(at + 4, position[1], true);
    view.setFloat32(at + 8, position[2], true);
    const weights = vertex.boneWeights ?? [255, 0, 0, 0];
    weights.forEach((weight, c) => view.setUint8(at + 12 + c, weight));
    const indices = vertex.boneIndices ?? [0, 0, 0, 0];
    indices.forEach((index, c) => view.setUint8(at + 16 + c, index));
    const normal = vertex.normal ?? [0, 0, 1];
    view.setFloat32(at + 20, normal[0], true);
    view.setFloat32(at + 24, normal[1], true);
    view.setFloat32(at + 28, normal[2], true);
    (vertex.uvs ?? [[0, 0]]).slice(0, 2).forEach((uv, set) => {
      view.setFloat32(at + 32 + set * 8, uv[0], true);
      view.setFloat32(at + 36 + set * 8, uv[1], true);
    });
  });
  writer.array(0x3c, vertices.length, vertexOffset);
  view.setUint32(0x44, options.viewCount ?? 1, true);

  const textureOffset = writer.alloc(textures.length * 16);
  textures.forEach((texture, i) => {
    view.setUint32(textureOffset + i * 16, texture.type ?? 0, true);
    view.setUint32(textureOffset + i * 16 + 4, texture.flags ?? 0, true);
  });
  writer.array(0x50, textures.length, textureOffset);

  const transformOffset = writer.alloc(textureTransforms.length * 0x3c);
  textureTransforms.forEach((transform, i) => {
    const at = transformOffset + i * 0x3c;
    writer.writeTrack(at, transform.translation, trackSlots, "float32x3");
    writer.writeTrack(at + 0x14, transform.rotation, trackSlots, "float32x4");
    writer.writeTrack(at + 0x28, transform.scale, trackSlots, "float32x3");
  });
  writer.array(0x60, textureTransforms.length, transformOffset);

  const writeU16Array = (headerOffset: number, values: number[] | undefined) => {
    const list = values ?? [];
    const dataOffset = writer.alloc(list.length * 2);
    list.forEach((value, i) => view.setUint16(dataOffset + i * 2, value, true));
    writer.array(headerOffset, list.length, dataOffset);
  };
  writeU16Array(0x68, options.replaceableLookup);
  const materialOffset = writer.alloc(materials.length * 4);
  materials.forEach((material, i) => {
    view.setUint16(materialOffset + i * 4, material.flags ?? 0, true);
    view.setUint16(materialOffset + i * 4 + 2, material.blendMode ?? 2, true);
  });
  writer.array(0x70, materials.length, materialOffset);
  writeU16Array(0x78, options.boneLookup);
  writeU16Array(0x80, options.textureLookup);
  writeU16Array(0x88, options.textureUnitLookup);
  writeU16Array(0x90, options.textureWeightLookup);
  writeU16Array(0x98, options.textureTransformLookup);

  const box = options.boundingBox ?? [-1, -1, 0, 1, 1, 2];
  for (let i = 0; i < 6; i += 1) view.setFloat32(0xa0 + i * 4, box[i], true);
  view.setFloat32(0xb8, options.boundingRadius ?? 1, true);
  for (let i = 0; i < 6; i += 1) view.setFloat32(0xbc + i * 4, box[i], true);
  view.setFloat32(0xd4, options.boundingRadius ?? 1, true);

  const attachmentOffset = writer.alloc(attachments.length * 0x28);
  attachments.forEach((attachment, i) => {
    const at = attachmentOffset + i * 0x28;
    view.setUint32(at, attachment.id, true);
    view.setUint16(at + 4, attachment.bone ?? 0, true);
    view.setUint16(at + 6, attachment.flags ?? 0, true);
    const position = attachment.position ?? [0, 0, 0];
    view.setFloat32(at + 8, position[0], true);
    view.setFloat32(at + 12, position[1], true);
    view.setFloat32(at + 16, position[2], true);
    writer.writeTrack(at + 20, undefined, trackSlots, "int16");
  });
  writer.array(0xf0, attachments.length, attachmentOffset);
  writeU16Array(0xf8, options.attachmentLookup);

  const payload = new Uint8Array(buffer, 0, writer.nextOffset);
  const chunks: Array<{ tag: string; payload: Uint8Array | ArrayBuffer }> = [{ tag: "MD21", payload }];
  if (options.skinFileDataIds) {
    chunks.push({ tag: "SFID", payload: new Uint8Array(new Uint32Array(options.skinFileDataIds).buffer) });
  }
  if (options.textureFileDataIds) {
    chunks.push({ tag: "TXID", payload: new Uint8Array(new Uint32Array(options.textureFileDataIds).buffer) });
  }
  if (options.animationFiles?.length) {
    const bytes = new Uint8Array(options.animationFiles.length * 8);
    const animationView = new DataView(bytes.buffer);
    options.animationFiles.forEach((entry, i) => {
      animationView.setUint16(i * 8, entry.animationId, true);
      animationView.setUint16(i * 8 + 2, entry.variationIndex, true);
      animationView.setUint32(i * 8 + 4, entry.fileDataId, true);
    });
    chunks.push({ tag: "AFID", payload: bytes });
  }
  if (options.skeletonFileDataId) {
    chunks.push({ tag: "SKID", payload: new Uint8Array(new Uint32Array([options.skeletonFileDataId]).buffer) });
  }
  for (const chunk of options.extraChunks ?? []) {
    chunks.push({ tag: chunk.tag, payload: chunk.payload ?? new ArrayBuffer(4) });
  }
  return assembleChunks(chunks);
}

export interface SkinFixtureOptions {
  fileDataId?: number;
  vertexLookup?: number[];
  indices?: number[];
  bones?: number[][];
  sections?: FixtureSection[];
  batches?: FixtureBatch[];
  shadowBatchCount?: number;
}

export function buildSkinFixture(options: SkinFixtureOptions = {}): ArrayBuffer {
  const vertexLookup = options.vertexLookup ?? [];
  const indices = options.indices ?? [];
  const bones = options.bones ?? [];
  const sections = options.sections ?? [];
  const batches = options.batches ?? [];
  const shadowBatchCount = options.shadowBatchCount ?? 0;

  const arrays = [
    vertexLookup.length * 2, indices.length * 2, bones.length * 4,
    sections.length * 0x30, batches.length * 0x18, shadowBatchCount * 12,
  ];
  const payloadSize = 0x40 + arrays.reduce((sum, size) => sum + size, 0);
  const buffer = new ArrayBuffer(payloadSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  bytes.set(new TextEncoder().encode("SKIN"), 0);
  // Array descriptors live at fixed header offsets; their data follows the 0x40 header.
  let cursor = 0x40;
  const place = (descriptorOffset: number, count: number, stride: number, write: (dataOffset: number) => void) => {
    view.setUint32(descriptorOffset, count, true);
    view.setUint32(descriptorOffset + 4, cursor, true);
    write(cursor);
    cursor += count * stride;
  };
  place(4, vertexLookup.length, 2, (at) => vertexLookup.forEach((v, i) => view.setUint16(at + i * 2, v, true)));
  place(0xc, indices.length, 2, (at) => indices.forEach((v, i) => view.setUint16(at + i * 2, v, true)));
  place(0x14, bones.length, 4, (at) => bones.forEach((bone, i) => bone.forEach((b, c) => view.setUint8(at + i * 4 + c, b))));
  place(0x1c, sections.length, 0x30, (at) => sections.forEach((section, i) => {
    const record = at + i * 0x30;
    view.setUint16(record, section.meshPartId ?? 0, true);
    view.setUint16(record + 2, section.level ?? 0, true);
    view.setUint16(record + 4, section.vertexStart ?? 0, true);
    view.setUint16(record + 6, section.vertexCount ?? 0, true);
    view.setUint16(record + 8, section.indexStart ?? 0, true);
    view.setUint16(record + 10, section.indexCount ?? 0, true);
    view.setUint16(record + 12, section.boneCount ?? 1, true);
    view.setUint16(record + 14, section.boneStart ?? 0, true);
    view.setFloat32(record + 0x2c, 1, true); // sortRadius
  }));
  place(0x24, batches.length, 0x18, (at) => batches.forEach((batch, i) => {
    const record = at + i * 0x18;
    view.setUint8(record, batch.flags ?? 0);
    view.setInt8(record + 1, batch.priorityPlane ?? 0);
    view.setUint16(record + 2, batch.shaderId ?? 0x14, true);
    view.setUint16(record + 4, batch.sectionIndex ?? 0, true);
    view.setUint16(record + 6, batch.flags2 ?? 0, true);
    view.setInt16(record + 8, batch.colorIndex ?? -1, true);
    view.setUint16(record + 10, batch.materialIndex ?? 0, true);
    view.setUint16(record + 12, batch.materialLayer ?? 0, true);
    view.setUint16(record + 14, batch.textureCount ?? 1, true);
    view.setUint16(record + 16, batch.textureComboIndex ?? 0, true);
    view.setUint16(record + 18, batch.textureCoordComboIndex ?? 0, true);
    view.setUint16(record + 20, batch.textureWeightComboIndex ?? 0, true);
    view.setUint16(record + 22, batch.textureTransformComboIndex ?? 0, true);
  }));
  view.setUint32(0x30, shadowBatchCount, true);
  view.setUint32(0x34, cursor, true);
  return buffer;
}

export interface AnimFixtureOptions {
  /** The raw track payload bytes that the ANIM file must expose. */
  payload: number[] | Uint8Array;
  mode?: "raw" | "chunked";
  /** Decoy bytes written into AFM2 when AFSB carries the real payload. */
  afm2Decoy?: number[] | Uint8Array;
  extraChunks?: Array<{ tag: string; payload?: number[] | Uint8Array }>;
}

export function buildAnimFixture(options: AnimFixtureOptions): ArrayBuffer {
  const payload = options.payload instanceof Uint8Array ? options.payload : new Uint8Array(options.payload);
  if (options.mode !== "chunked") return payload.slice().buffer;
  const chunks: Array<{ tag: string; payload: Uint8Array | ArrayBuffer }> = [];
  if (options.afm2Decoy) {
    const decoy = options.afm2Decoy instanceof Uint8Array ? options.afm2Decoy : new Uint8Array(options.afm2Decoy);
    chunks.push({ tag: "AFM2", payload: decoy.slice() });
    chunks.push({ tag: "AFSB", payload: payload.slice() });
  } else {
    chunks.push({ tag: "AFM2", payload: payload.slice() });
  }
  for (const chunk of options.extraChunks ?? []) {
    const bytes = chunk.payload
      ? (chunk.payload instanceof Uint8Array ? chunk.payload : new Uint8Array(chunk.payload))
      : new Uint8Array(4);
    chunks.push({ tag: chunk.tag, payload: bytes.slice() });
  }
  return assembleChunks(chunks);
}

export interface SkelFixtureOptions {
  fileDataId?: number;
  globalSequences?: number[];
  sequences?: FixtureSequence[];
  sequenceLookup?: number[];
  bones?: FixtureBone[];
  parentSkeletonFileDataId?: number;
  animationFiles?: Array<{ animationId: number; variationIndex: number; fileDataId: number }>;
  attachments?: FixtureAttachment[];
  attachmentLookup?: number[];
  extraChunks?: Array<{ tag: string; payload?: Uint8Array | ArrayBuffer }>;
}

export function buildSkelFixture(options: SkelFixtureOptions = {}): ArrayBuffer {
  const sequences = options.sequences ?? [];
  const bones = options.bones ?? [];
  const attachments = options.attachments ?? [];

  // SKS1: globalLoops, sequences, lookup, then eight unused u32 counters.
  const trackSlots = Math.max(1, sequences.length);
  const sks1 = new ArrayBuffer(0x800);
  const sks1Writer = new PayloadWriter(sks1, 0x38);
  const globalSequences = options.globalSequences ?? [];
  const globalSequenceOffset = sks1Writer.alloc(globalSequences.length * 4);
  globalSequences.forEach((duration, i) => sks1Writer.view.setUint32(globalSequenceOffset + i * 4, duration, true));
  sks1Writer.array(0, globalSequences.length, globalSequenceOffset);
  const sequenceOffset = sks1Writer.alloc(sequences.length * 0x40);
  sequences.forEach((sequence, i) => {
    const at = sequenceOffset + i * 0x40;
    sks1Writer.view.setUint16(at, sequence.animationId, true);
    sks1Writer.view.setUint16(at + 2, sequence.variationIndex ?? 0, true);
    sks1Writer.view.setUint32(at + 4, sequence.durationMs ?? 1000, true);
    sks1Writer.view.setUint32(at + 0xc, sequence.flags ?? 0x20, true);
    sks1Writer.view.setUint16(at + 0x3e, sequence.aliasNext ?? 0, true);
  });
  sks1Writer.array(8, sequences.length, sequenceOffset);
  const lookup = options.sequenceLookup ?? [];
  const lookupOffset = sks1Writer.alloc(lookup.length * 2);
  lookup.forEach((value, i) => sks1Writer.view.setInt16(lookupOffset + i * 2, value, true));
  sks1Writer.array(0x10, lookup.length, lookupOffset);

  // SKB1: bone array descriptor at 0; bone track offsets relative to the SKB1 payload.
  const skb1 = new ArrayBuffer(0x4000);
  const skb1Writer = new PayloadWriter(skb1, 8);
  const boneOffset = skb1Writer.alloc(bones.length * 0x58);
  bones.forEach((bone, i) => {
    const at = boneOffset + i * 0x58;
    skb1Writer.view.setInt32(at, bone.keyBoneId ?? -1, true);
    skb1Writer.view.setInt16(at + 8, bone.parent ?? -1, true);
    skb1Writer.writeTrack(at + 0x10, bone.translation, trackSlots, "float32x3");
    skb1Writer.writeTrack(at + 0x24, bone.rotation, trackSlots, "quaternion16");
    skb1Writer.writeTrack(at + 0x38, bone.scale, trackSlots, "float32x3");
    const pivot = bone.pivot ?? [0, 0, 0];
    skb1Writer.view.setFloat32(at + 0x4c, pivot[0], true);
    skb1Writer.view.setFloat32(at + 0x50, pivot[1], true);
    skb1Writer.view.setFloat32(at + 0x54, pivot[2], true);
  });
  skb1Writer.array(0, bones.length, boneOffset);

  // SKA1: attachments at 0, attachment lookup at 8.
  const ska1 = new ArrayBuffer(0x1000);
  const ska1Writer = new PayloadWriter(ska1, 0x18);
  const attachmentOffset = ska1Writer.alloc(attachments.length * 0x28);
  attachments.forEach((attachment, i) => {
    const at = attachmentOffset + i * 0x28;
    ska1Writer.view.setUint32(at, attachment.id, true);
    ska1Writer.view.setUint16(at + 4, attachment.bone ?? 0, true);
    const position = attachment.position ?? [0, 0, 0];
    ska1Writer.view.setFloat32(at + 8, position[0], true);
    ska1Writer.view.setFloat32(at + 12, position[1], true);
    ska1Writer.view.setFloat32(at + 16, position[2], true);
    ska1Writer.writeTrack(at + 20, undefined, trackSlots, "int16");
  });
  ska1Writer.array(0, attachments.length, attachmentOffset);
  const attachmentLookup = options.attachmentLookup ?? [];
  const attachmentLookupOffset = ska1Writer.alloc(attachmentLookup.length * 2);
  attachmentLookup.forEach((value, i) => ska1Writer.view.setInt16(attachmentLookupOffset + i * 2, value, true));
  ska1Writer.array(8, attachmentLookup.length, attachmentLookupOffset);

  const skpd = new ArrayBuffer(4);
  new DataView(skpd).setUint32(0, options.parentSkeletonFileDataId ?? 0, true);

  const chunks: Array<{ tag: string; payload: Uint8Array | ArrayBuffer }> = [
    { tag: "SKS1", payload: new Uint8Array(sks1, 0, sks1Writer.nextOffset) },
    { tag: "SKB1", payload: new Uint8Array(skb1, 0, skb1Writer.nextOffset) },
    { tag: "SKA1", payload: new Uint8Array(ska1, 0, ska1Writer.nextOffset) },
    { tag: "SKPD", payload: skpd },
  ];
  if (options.animationFiles?.length) {
    const bytes = new Uint8Array(options.animationFiles.length * 8);
    const animationView = new DataView(bytes.buffer);
    options.animationFiles.forEach((entry, i) => {
      animationView.setUint16(i * 8, entry.animationId, true);
      animationView.setUint16(i * 8 + 2, entry.variationIndex, true);
      animationView.setUint32(i * 8 + 4, entry.fileDataId, true);
    });
    chunks.push({ tag: "AFID", payload: bytes });
  }
  for (const chunk of options.extraChunks ?? []) {
    chunks.push({ tag: chunk.tag, payload: chunk.payload ?? new ArrayBuffer(4) });
  }
  return assembleChunks(chunks);
}
