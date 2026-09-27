export interface DecodedBlp {
  width: number;
  height: number;
  pixels: Uint8Array;
  compression: "BC1" | "BC2" | "BC3";
}

function assetLabel(fileDataId?: number) {
  return fileDataId === undefined ? "BLP source" : `FileDataID ${fileDataId}`;
}

function expandRgb565(value: number): [number, number, number] {
  const red = (value >> 11) & 0x1f;
  const green = (value >> 5) & 0x3f;
  const blue = value & 0x1f;
  return [
    Math.round((red * 255) / 31),
    Math.round((green * 255) / 63),
    Math.round((blue * 255) / 31),
  ];
}

function interpolateColor(
  first: [number, number, number, number],
  second: [number, number, number, number],
  firstWeight: number,
  secondWeight: number,
  divisor: number,
): [number, number, number, number] {
  return [
    Math.floor((first[0] * firstWeight + second[0] * secondWeight) / divisor),
    Math.floor((first[1] * firstWeight + second[1] * secondWeight) / divisor),
    Math.floor((first[2] * firstWeight + second[2] * secondWeight) / divisor),
    Math.floor((first[3] * firstWeight + second[3] * secondWeight) / divisor),
  ];
}

function decodeColorBlock(
  source: DataView,
  blockOffset: number,
  isBc1: boolean,
  hasBc1Transparency: boolean,
): Array<[number, number, number, number]> {
  const firstEndpoint = source.getUint16(blockOffset, true);
  const secondEndpoint = source.getUint16(blockOffset + 2, true);
  const first: [number, number, number, number] = [...expandRgb565(firstEndpoint), 255];
  const second: [number, number, number, number] = [...expandRgb565(secondEndpoint), 255];
  if (isBc1 && firstEndpoint <= secondEndpoint) {
    return [
      first,
      second,
      interpolateColor(first, second, 1, 1, 2),
      [0, 0, 0, hasBc1Transparency ? 0 : 255],
    ];
  }
  return [
    first,
    second,
    interpolateColor(first, second, 2, 1, 3),
    interpolateColor(first, second, 1, 2, 3),
  ];
}

function decodeBc3Alpha(source: DataView, blockOffset: number) {
  const first = source.getUint8(blockOffset);
  const second = source.getUint8(blockOffset + 1);
  if (first > second) {
    return [
      first,
      second,
      ...Array.from({ length: 6 }, (_, index) =>
        Math.floor(((6 - index) * first + (index + 1) * second) / 7)),
    ];
  }
  return [
    first,
    second,
    ...Array.from({ length: 4 }, (_, index) =>
      Math.floor(((4 - index) * first + (index + 1) * second) / 5)),
    0,
    255,
  ];
}

export function decodeNativeBlp(sourceBuffer: ArrayBuffer, fileDataId?: number): DecodedBlp {
  const label = assetLabel(fileDataId);
  if (sourceBuffer.byteLength < 1172) {
    throw new Error(`${label}: BLP2 header and extension are outside source bounds.`);
  }
  const sourceBytes = new Uint8Array(sourceBuffer);
  if (String.fromCharCode(...sourceBytes.subarray(0, 4)) !== "BLP2") {
    throw new Error(`${label}: expected BLP2 magic.`);
  }
  const source = new DataView(sourceBuffer);
  const version = source.getUint32(4, true);
  if (version !== 1) throw new Error(`${label}: unsupported BLP2 version ${version}.`);

  const encoding = source.getUint8(8);
  const alphaDepth = source.getUint8(9);
  const alphaEncoding = source.getUint8(10);
  if (encoding !== 2) {
    throw new Error(`${label}: BLP encoding ${encoding} is unsupported; this proof requires original BC1/BC2/BC3 texture data.`);
  }

  let compression: DecodedBlp["compression"];
  let bytesPerBlock: number;
  if (alphaEncoding === 0 && (alphaDepth === 0 || alphaDepth === 1)) {
    compression = "BC1";
    bytesPerBlock = 8;
  } else if (alphaEncoding === 1 && alphaDepth === 8) {
    compression = "BC2";
    bytesPerBlock = 16;
  } else if (alphaEncoding === 7 && alphaDepth === 8) {
    compression = "BC3";
    bytesPerBlock = 16;
  } else {
    throw new Error(`${label}: unsupported BLP alpha layout depth ${alphaDepth}, encoding ${alphaEncoding}.`);
  }

  const width = source.getUint32(12, true);
  const height = source.getUint32(16, true);
  if (width === 0 || height === 0 || width > 4096 || height > 4096) {
    throw new Error(`${label}: invalid BLP dimensions ${width}x${height}.`);
  }
  const mipOffset = source.getUint32(20, true);
  const mipSize = source.getUint32(84, true);
  const blockColumns = Math.ceil(width / 4);
  const blockRows = Math.ceil(height / 4);
  const requiredMipSize = blockColumns * blockRows * bytesPerBlock;
  if (mipSize < requiredMipSize) {
    throw new Error(`${label}: first mip requires ${requiredMipSize} bytes but records ${mipSize}.`);
  }
  if (mipOffset < 1172 || mipOffset > sourceBuffer.byteLength || mipSize > sourceBuffer.byteLength - mipOffset) {
    throw new Error(`${label}: first mip is outside source bounds.`);
  }

  const pixels = new Uint8Array(width * height * 4);
  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockColumns; blockX += 1) {
      const blockIndex = blockY * blockColumns + blockX;
      const blockOffset = mipOffset + blockIndex * bytesPerBlock;
      const colorOffset = compression === "BC1" ? blockOffset : blockOffset + 8;
      const colors = decodeColorBlock(source, colorOffset, compression === "BC1", alphaDepth === 1);
      const colorSelectors = source.getUint32(colorOffset + 4, true);
      const alphaValues = compression === "BC3" ? decodeBc3Alpha(source, blockOffset) : null;
      let alphaSelectors = 0n;
      if (compression === "BC3") {
        for (let index = 0; index < 6; index += 1) {
          alphaSelectors |= BigInt(source.getUint8(blockOffset + 2 + index)) << BigInt(index * 8);
        }
      }

      for (let localY = 0; localY < 4; localY += 1) {
        for (let localX = 0; localX < 4; localX += 1) {
          const x = blockX * 4 + localX;
          const y = blockY * 4 + localY;
          if (x >= width || y >= height) continue;
          const pixelInBlock = localY * 4 + localX;
          const color = colors[(colorSelectors >> (pixelInBlock * 2)) & 0x3];
          const destination = (y * width + x) * 4;
          pixels[destination] = color[0];
          pixels[destination + 1] = color[1];
          pixels[destination + 2] = color[2];
          pixels[destination + 3] = alphaValues
            ? alphaValues[Number((alphaSelectors >> BigInt(pixelInBlock * 3)) & 0x7n)]
            : compression === "BC2" ? ((source.getUint8(blockOffset + (pixelInBlock >> 1)) >> ((pixelInBlock & 1) * 4)) & 0xf) * 17
              : color[3];
        }
      }
    }
  }

  return { width, height, pixels, compression };
}
