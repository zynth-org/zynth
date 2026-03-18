export type QRErrorCorrectionLevel = "L" | "M" | "Q" | "H";

export interface QRCodeMatrixOptions {
  value: string;
  level?: QRErrorCorrectionLevel;
  minVersion?: number;
  maxVersion?: number;
}

type QRBlock = {
  totalCount: number;
  dataCount: number;
};

type Matrix = Array<Array<number>>;

const PAD0 = 0xec;
const PAD1 = 0x11;

const EC_LEVEL_BITS: Record<QRErrorCorrectionLevel, number> = {
  L: 1,
  M: 0,
  Q: 3,
  H: 2,
};

const ALIGNMENT_PATTERN_POSITIONS: Array<Array<number>> = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
];

// Versions 1..10, each row has L, M, Q, H blocks as repeating triples:
// [count, totalCount, dataCount, count, totalCount, dataCount, ...]
const RS_BLOCK_TABLE: Array<Array<Array<number>>> = [
  [
    [1, 26, 19],
    [1, 26, 16],
    [1, 26, 13],
    [1, 26, 9],
  ],
  [
    [1, 44, 34],
    [1, 44, 28],
    [1, 44, 22],
    [1, 44, 16],
  ],
  [
    [1, 70, 55],
    [1, 70, 44],
    [2, 35, 17],
    [2, 35, 13],
  ],
  [
    [1, 100, 80],
    [2, 50, 32],
    [2, 50, 24],
    [4, 25, 9],
  ],
  [
    [1, 134, 108],
    [2, 67, 43],
    [2, 33, 15, 2, 34, 16],
    [2, 33, 11, 2, 34, 12],
  ],
  [
    [2, 86, 68],
    [4, 43, 27],
    [4, 43, 19],
    [4, 43, 15],
  ],
  [
    [2, 98, 78],
    [4, 49, 31],
    [2, 32, 14, 4, 33, 15],
    [4, 39, 13, 1, 40, 14],
  ],
  [
    [2, 121, 97],
    [2, 60, 38, 2, 61, 39],
    [4, 40, 18, 2, 41, 19],
    [4, 40, 14, 2, 41, 15],
  ],
  [
    [2, 146, 116],
    [3, 58, 36, 2, 59, 37],
    [4, 36, 16, 4, 37, 17],
    [4, 36, 12, 4, 37, 13],
  ],
  [
    [2, 86, 68, 2, 87, 69],
    [4, 69, 43, 1, 70, 44],
    [6, 43, 19, 2, 44, 20],
    [6, 43, 15, 2, 44, 16],
  ],
];

const BYTE_CAPACITY: Record<QRErrorCorrectionLevel, Array<number>> = {
  L: [17, 32, 53, 78, 106, 134, 154, 192, 230, 271],
  M: [14, 26, 42, 62, 84, 106, 122, 152, 180, 213],
  Q: [11, 20, 32, 46, 60, 74, 86, 108, 130, 151],
  H: [7, 14, 24, 34, 44, 58, 64, 84, 98, 119],
};

const EXP_TABLE: Array<number> = new Array<number>(512);
const LOG_TABLE: Array<number> = new Array<number>(256);

for (let i = 0; i < 8; i += 1) {
  EXP_TABLE[i] = 1 << i;
}
for (let i = 8; i < 256; i += 1) {
  EXP_TABLE[i] = EXP_TABLE[i - 4] ^ EXP_TABLE[i - 5] ^ EXP_TABLE[i - 6] ^ EXP_TABLE[i - 8];
}
for (let i = 0; i < 255; i += 1) {
  LOG_TABLE[EXP_TABLE[i]] = i;
}
for (let i = 255; i < 512; i += 1) {
  EXP_TABLE[i] = EXP_TABLE[i - 255];
}

class BitBuffer {
  private readonly bits: Array<number> = [];

  public getLengthInBits(): number {
    return this.bits.length;
  }

  public getBuffer(): Array<number> {
    const bytes: Array<number> = [];
    const bitLength = this.bits.length;
    const byteLength = Math.ceil(bitLength / 8);
    for (let i = 0; i < byteLength; i += 1) {
      bytes.push(0);
    }
    for (let i = 0; i < bitLength; i += 1) {
      if (this.bits[i] === 1) {
        bytes[Math.floor(i / 8)] |= 0x80 >>> (i % 8);
      }
    }
    return bytes;
  }

  public put(num: number, length: number): void {
    for (let i = 0; i < length; i += 1) {
      this.putBit(((num >>> (length - i - 1)) & 1) === 1);
    }
  }

  public putBit(bit: boolean): void {
    this.bits.push(bit ? 1 : 0);
  }
}

const utf8Encode = (value: string): Uint8Array => {
  if (typeof TextEncoder !== "undefined") {
    return new TextEncoder().encode(value);
  }

  const out: Array<number> = [];
  for (let i = 0; i < value.length; i += 1) {
    const codePoint = value.codePointAt(i);
    if (codePoint == null) continue;
    if (codePoint > 0xffff) {
      i += 1;
    }
    if (codePoint < 0x80) {
      out.push(codePoint);
      continue;
    }
    if (codePoint < 0x800) {
      out.push(0xc0 | (codePoint >>> 6));
      out.push(0x80 | (codePoint & 0x3f));
      continue;
    }
    if (codePoint < 0x10000) {
      out.push(0xe0 | (codePoint >>> 12));
      out.push(0x80 | ((codePoint >>> 6) & 0x3f));
      out.push(0x80 | (codePoint & 0x3f));
      continue;
    }
    out.push(0xf0 | (codePoint >>> 18));
    out.push(0x80 | ((codePoint >>> 12) & 0x3f));
    out.push(0x80 | ((codePoint >>> 6) & 0x3f));
    out.push(0x80 | (codePoint & 0x3f));
  }
  return new Uint8Array(out);
};

const getLevelIndex = (level: QRErrorCorrectionLevel): number => {
  if (level === "L") return 0;
  if (level === "M") return 1;
  if (level === "Q") return 2;
  return 3;
};

const getRSBlocks = (version: number, level: QRErrorCorrectionLevel): Array<QRBlock> => {
  const versionEntry = RS_BLOCK_TABLE[version - 1];
  if (!versionEntry) {
    throw new Error(`Unsupported QR version: ${version}. Supported range is 1..10.`);
  }
  const raw = versionEntry[getLevelIndex(level)];
  if (!raw) {
    throw new Error(`Unsupported EC level ${level} for version ${version}.`);
  }

  const blocks: Array<QRBlock> = [];
  for (let i = 0; i < raw.length; i += 3) {
    const count = raw[i];
    const totalCount = raw[i + 1];
    const dataCount = raw[i + 2];
    for (let j = 0; j < count; j += 1) {
      blocks.push({ totalCount, dataCount });
    }
  }
  return blocks;
};

const gexp = (n: number): number => {
  let value = n;
  while (value < 0) {
    value += 255;
  }
  while (value >= 255) {
    value -= 255;
  }
  return EXP_TABLE[value];
};

const glog = (n: number): number => {
  if (n <= 0) {
    throw new Error(`glog(${n})`);
  }
  return LOG_TABLE[n];
};

const multiplyPoly = (a: Array<number>, b: Array<number>): Array<number> => {
  const out: Array<number> = [];
  for (let i = 0; i < a.length + b.length - 1; i += 1) {
    out.push(0);
  }

  for (let i = 0; i < a.length; i += 1) {
    for (let j = 0; j < b.length; j += 1) {
      out[i + j] ^= gexp(glog(a[i]) + glog(b[j]));
    }
  }

  return out;
};

const getErrorCorrectPolynomial = (errorCorrectLength: number): Array<number> => {
  let poly: Array<number> = [1];
  for (let i = 0; i < errorCorrectLength; i += 1) {
    poly = multiplyPoly(poly, [1, gexp(i)]);
  }
  return poly;
};

const modPoly = (data: Array<number>, divisor: Array<number>): Array<number> => {
  const result = data.slice();
  while (result.length >= divisor.length) {
    const ratio = glog(result[0]) - glog(divisor[0]);
    for (let i = 0; i < divisor.length; i += 1) {
      result[i] ^= gexp(glog(divisor[i]) + ratio);
    }
    while (result.length > 0 && result[0] === 0) {
      result.shift();
    }
  }
  return result;
};

const getBCHTypeInfo = (data: number): number => {
  let d = data << 10;
  const g15 = 0b10100110111;
  while (getBCHDigit(d) - getBCHDigit(g15) >= 0) {
    d ^= g15 << (getBCHDigit(d) - getBCHDigit(g15));
  }
  return ((data << 10) | d) ^ 0b101010000010010;
};

const getBCHTypeNumber = (data: number): number => {
  let d = data << 12;
  const g18 = 0b1111100100101;
  while (getBCHDigit(d) - getBCHDigit(g18) >= 0) {
    d ^= g18 << (getBCHDigit(d) - getBCHDigit(g18));
  }
  return (data << 12) | d;
};

const getBCHDigit = (data: number): number => {
  let digit = 0;
  let value = data;
  while (value !== 0) {
    digit += 1;
    value >>>= 1;
  }
  return digit;
};

const getMask = (maskPattern: number, row: number, col: number): boolean => {
  if (maskPattern === 0) return (row + col) % 2 === 0;
  if (maskPattern === 1) return row % 2 === 0;
  if (maskPattern === 2) return col % 3 === 0;
  if (maskPattern === 3) return (row + col) % 3 === 0;
  if (maskPattern === 4) return (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0;
  if (maskPattern === 5) return ((row * col) % 2) + ((row * col) % 3) === 0;
  if (maskPattern === 6) return ((((row * col) % 2) + ((row * col) % 3)) % 2) === 0;
  return ((((row + col) % 2) + ((row * col) % 3)) % 2) === 0;
};

const createEmptyMatrix = (moduleCount: number): Matrix => {
  const matrix: Matrix = [];
  for (let row = 0; row < moduleCount; row += 1) {
    const line: Array<number> = [];
    for (let col = 0; col < moduleCount; col += 1) {
      line.push(-1);
    }
    matrix.push(line);
  }
  return matrix;
};

const createEmptyReserved = (moduleCount: number): Matrix => {
  const matrix: Matrix = [];
  for (let row = 0; row < moduleCount; row += 1) {
    const line: Array<number> = [];
    for (let col = 0; col < moduleCount; col += 1) {
      line.push(0);
    }
    matrix.push(line);
  }
  return matrix;
};

const setModule = (
  matrix: Matrix,
  reserved: Matrix,
  row: number,
  col: number,
  value: number,
  isReserved: boolean,
): void => {
  if (row < 0 || col < 0 || row >= matrix.length || col >= matrix.length) {
    return;
  }
  matrix[row][col] = value;
  if (isReserved) {
    reserved[row][col] = 1;
  }
};

const setupFinderPattern = (matrix: Matrix, reserved: Matrix, row: number, col: number): void => {
  for (let r = -1; r <= 7; r += 1) {
    for (let c = -1; c <= 7; c += 1) {
      const targetRow = row + r;
      const targetCol = col + c;

      if (targetRow < 0 || targetCol < 0 || targetRow >= matrix.length || targetCol >= matrix.length) {
        continue;
      }

      const isBorder = r === -1 || r === 7 || c === -1 || c === 7;
      const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
      const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      const dark = isOuter || isInner;

      setModule(matrix, reserved, targetRow, targetCol, isBorder ? 0 : (dark ? 1 : 0), true);
    }
  }
};

const setupTimingPattern = (matrix: Matrix, reserved: Matrix): void => {
  const moduleCount = matrix.length;
  for (let i = 8; i < moduleCount - 8; i += 1) {
    const bit = i % 2 === 0 ? 1 : 0;
    if (reserved[i][6] === 0) {
      setModule(matrix, reserved, i, 6, bit, true);
    }
    if (reserved[6][i] === 0) {
      setModule(matrix, reserved, 6, i, bit, true);
    }
  }
};

const setupAlignmentPattern = (matrix: Matrix, reserved: Matrix, version: number): void => {
  if (version === 1) return;

  const positions = ALIGNMENT_PATTERN_POSITIONS[version - 1];
  for (let i = 0; i < positions.length; i += 1) {
    for (let j = 0; j < positions.length; j += 1) {
      const row = positions[i];
      const col = positions[j];
      if (reserved[row][col] === 1) {
        continue;
      }

      for (let r = -2; r <= 2; r += 1) {
        for (let c = -2; c <= 2; c += 1) {
          const dist = Math.max(Math.abs(r), Math.abs(c));
          const dark = dist !== 1;
          setModule(matrix, reserved, row + r, col + c, dark ? 1 : 0, true);
        }
      }
    }
  }
};

const setupVersionInfo = (matrix: Matrix, reserved: Matrix, version: number): void => {
  if (version < 7) return;

  const bits = getBCHTypeNumber(version);
  const moduleCount = matrix.length;
  for (let i = 0; i < 18; i += 1) {
    const bit = ((bits >>> i) & 1) === 1 ? 1 : 0;
    const row1 = Math.floor(i / 3);
    const col1 = (i % 3) + moduleCount - 11;
    setModule(matrix, reserved, row1, col1, bit, true);

    const row2 = (i % 3) + moduleCount - 11;
    const col2 = Math.floor(i / 3);
    setModule(matrix, reserved, row2, col2, bit, true);
  }
};

const setupFormatInfo = (
  matrix: Matrix,
  reserved: Matrix,
  level: QRErrorCorrectionLevel,
  maskPattern: number,
): void => {
  const data = (EC_LEVEL_BITS[level] << 3) | maskPattern;
  const bits = getBCHTypeInfo(data);
  const moduleCount = matrix.length;

  for (let i = 0; i < 15; i += 1) {
    const bit = ((bits >>> i) & 1) === 1 ? 1 : 0;

    // Vertical timing-adjacent format bits.
    if (i < 6) {
      setModule(matrix, reserved, i, 8, bit, true);
    } else if (i < 8) {
      setModule(matrix, reserved, i + 1, 8, bit, true);
    } else {
      setModule(matrix, reserved, moduleCount - 15 + i, 8, bit, true);
    }

    // Horizontal timing-adjacent format bits.
    if (i < 8) {
      setModule(matrix, reserved, 8, moduleCount - i - 1, bit, true);
    } else if (i < 9) {
      setModule(matrix, reserved, 8, 15 - i - 1 + 1, bit, true);
    } else {
      setModule(matrix, reserved, 8, 15 - i - 1, bit, true);
    }
  }

  setModule(matrix, reserved, moduleCount - 8, 8, 1, true);
};

const mapData = (
  matrix: Matrix,
  reserved: Matrix,
  codewords: Array<number>,
  maskPattern: number,
): void => {
  const moduleCount = matrix.length;
  let row = moduleCount - 1;
  let col = moduleCount - 1;
  let direction = -1;
  let bitIndex = 0;

  while (col > 0) {
    if (col === 6) {
      col -= 1;
    }

    while (true) {
      for (let c = 0; c < 2; c += 1) {
        const currentCol = col - c;
        if (reserved[row][currentCol] === 1) {
          continue;
        }

        const byteIndex = Math.floor(bitIndex / 8);
        let dark = 0;
        if (byteIndex < codewords.length) {
          dark = ((codewords[byteIndex] >>> (7 - (bitIndex % 8))) & 1) === 1 ? 1 : 0;
        }

        if (getMask(maskPattern, row, currentCol)) {
          dark ^= 1;
        }

        matrix[row][currentCol] = dark;
        bitIndex += 1;
      }

      row += direction;
      if (row < 0 || row >= moduleCount) {
        row -= direction;
        direction = -direction;
        break;
      }
    }

    col -= 2;
  }
};

const getLostPoint = (matrix: Matrix): number => {
  const moduleCount = matrix.length;
  let penalty = 0;

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      const current = matrix[row][col];
      let sameCount = 0;
      for (let r = -1; r <= 1; r += 1) {
        const rr = row + r;
        if (rr < 0 || rr >= moduleCount) continue;
        for (let c = -1; c <= 1; c += 1) {
          if (r === 0 && c === 0) continue;
          const cc = col + c;
          if (cc < 0 || cc >= moduleCount) continue;
          if (matrix[rr][cc] === current) {
            sameCount += 1;
          }
        }
      }
      if (sameCount > 5) {
        penalty += 3 + (sameCount - 5);
      }
    }
  }

  for (let row = 0; row < moduleCount - 1; row += 1) {
    for (let col = 0; col < moduleCount - 1; col += 1) {
      const count = matrix[row][col] + matrix[row + 1][col] + matrix[row][col + 1] + matrix[row + 1][col + 1];
      if (count === 0 || count === 4) {
        penalty += 3;
      }
    }
  }

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount - 6; col += 1) {
      if (
        matrix[row][col] === 1 &&
        matrix[row][col + 1] === 0 &&
        matrix[row][col + 2] === 1 &&
        matrix[row][col + 3] === 1 &&
        matrix[row][col + 4] === 1 &&
        matrix[row][col + 5] === 0 &&
        matrix[row][col + 6] === 1
      ) {
        if (
          (col >= 4 &&
            matrix[row][col - 1] === 0 &&
            matrix[row][col - 2] === 0 &&
            matrix[row][col - 3] === 0 &&
            matrix[row][col - 4] === 0) ||
          (col + 10 < moduleCount &&
            matrix[row][col + 7] === 0 &&
            matrix[row][col + 8] === 0 &&
            matrix[row][col + 9] === 0 &&
            matrix[row][col + 10] === 0)
        ) {
          penalty += 40;
        }
      }
    }
  }

  for (let col = 0; col < moduleCount; col += 1) {
    for (let row = 0; row < moduleCount - 6; row += 1) {
      if (
        matrix[row][col] === 1 &&
        matrix[row + 1][col] === 0 &&
        matrix[row + 2][col] === 1 &&
        matrix[row + 3][col] === 1 &&
        matrix[row + 4][col] === 1 &&
        matrix[row + 5][col] === 0 &&
        matrix[row + 6][col] === 1
      ) {
        if (
          (row >= 4 &&
            matrix[row - 1][col] === 0 &&
            matrix[row - 2][col] === 0 &&
            matrix[row - 3][col] === 0 &&
            matrix[row - 4][col] === 0) ||
          (row + 10 < moduleCount &&
            matrix[row + 7][col] === 0 &&
            matrix[row + 8][col] === 0 &&
            matrix[row + 9][col] === 0 &&
            matrix[row + 10][col] === 0)
        ) {
          penalty += 40;
        }
      }
    }
  }

  let darkCount = 0;
  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (matrix[row][col] === 1) {
        darkCount += 1;
      }
    }
  }

  const ratio = Math.abs((darkCount * 100) / (moduleCount * moduleCount) - 50) / 5;
  penalty += Math.floor(ratio) * 10;

  return penalty;
};

const createData = (
  version: number,
  level: QRErrorCorrectionLevel,
  dataBytes: Uint8Array,
): Array<number> => {
  const blocks = getRSBlocks(version, level);
  const bitBuffer = new BitBuffer();

  // Mode indicator: Byte mode.
  bitBuffer.put(0b0100, 4);

  // Character count indicator (bytes in byte mode).
  const countBits = version <= 9 ? 8 : 16;
  bitBuffer.put(dataBytes.length, countBits);

  for (let i = 0; i < dataBytes.length; i += 1) {
    bitBuffer.put(dataBytes[i], 8);
  }

  let totalDataCount = 0;
  for (let i = 0; i < blocks.length; i += 1) {
    totalDataCount += blocks[i].dataCount;
  }

  if (bitBuffer.getLengthInBits() > totalDataCount * 8) {
    throw new Error("Data too large for selected QR version and error correction level.");
  }

  if (bitBuffer.getLengthInBits() + 4 <= totalDataCount * 8) {
    bitBuffer.put(0, 4);
  }

  while (bitBuffer.getLengthInBits() % 8 !== 0) {
    bitBuffer.putBit(false);
  }

  while (bitBuffer.getBuffer().length < totalDataCount) {
    bitBuffer.put(PAD0, 8);
    if (bitBuffer.getBuffer().length >= totalDataCount) {
      break;
    }
    bitBuffer.put(PAD1, 8);
  }

  const data = bitBuffer.getBuffer();

  const dcData: Array<Array<number>> = [];
  const ecData: Array<Array<number>> = [];

  let offset = 0;
  let maxDcCount = 0;
  let maxEcCount = 0;

  for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
    const block = blocks[blockIndex];
    const dcCount = block.dataCount;
    const ecCount = block.totalCount - block.dataCount;

    if (dcCount > maxDcCount) maxDcCount = dcCount;
    if (ecCount > maxEcCount) maxEcCount = ecCount;

    const dc: Array<number> = data.slice(offset, offset + dcCount);
    offset += dcCount;

    const rsPoly = getErrorCorrectPolynomial(ecCount);
    const rawPoly: Array<number> = dc.slice();
    for (let i = 0; i < rsPoly.length - 1; i += 1) {
      rawPoly.push(0);
    }
    const remainder = modPoly(rawPoly, rsPoly);

    const ec: Array<number> = [];
    const padLength = ecCount - remainder.length;
    for (let i = 0; i < padLength; i += 1) {
      ec.push(0);
    }
    for (let i = 0; i < remainder.length; i += 1) {
      ec.push(remainder[i]);
    }

    dcData.push(dc);
    ecData.push(ec);
  }

  const output: Array<number> = [];

  for (let i = 0; i < maxDcCount; i += 1) {
    for (let r = 0; r < dcData.length; r += 1) {
      if (i < dcData[r].length) {
        output.push(dcData[r][i]);
      }
    }
  }

  for (let i = 0; i < maxEcCount; i += 1) {
    for (let r = 0; r < ecData.length; r += 1) {
      if (i < ecData[r].length) {
        output.push(ecData[r][i]);
      }
    }
  }

  return output;
};

const selectVersion = (
  dataLength: number,
  level: QRErrorCorrectionLevel,
  minVersion: number,
  maxVersion: number,
): number => {
  const capacities = BYTE_CAPACITY[level];
  const min = Math.max(1, minVersion);
  const max = Math.min(10, maxVersion);

  for (let version = min; version <= max; version += 1) {
    const capacity = capacities[version - 1];
    if (dataLength <= capacity) {
      return version;
    }
  }

  throw new Error(
    `Input too long for QR version range ${min}..${max} at EC level ${level}. ` +
      `Max bytes in this range: ${capacities[max - 1]}.`,
  );
};

const buildMatrix = (
  version: number,
  level: QRErrorCorrectionLevel,
  codewords: Array<number>,
  maskPattern: number,
): Matrix => {
  const moduleCount = version * 4 + 17;
  const matrix = createEmptyMatrix(moduleCount);
  const reserved = createEmptyReserved(moduleCount);

  setupFinderPattern(matrix, reserved, 0, 0);
  setupFinderPattern(matrix, reserved, moduleCount - 7, 0);
  setupFinderPattern(matrix, reserved, 0, moduleCount - 7);

  setupTimingPattern(matrix, reserved);
  setupAlignmentPattern(matrix, reserved, version);

  setModule(matrix, reserved, moduleCount - 8, 8, 1, true);
  setupVersionInfo(matrix, reserved, version);
  setupFormatInfo(matrix, reserved, level, maskPattern);

  mapData(matrix, reserved, codewords, maskPattern);

  return matrix;
};

const chooseBestMask = (
  version: number,
  level: QRErrorCorrectionLevel,
  codewords: Array<number>,
): Matrix => {
  let bestMatrix: Matrix | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
    const matrix = buildMatrix(version, level, codewords, maskPattern);
    const penalty = getLostPoint(matrix);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestMatrix = matrix;
    }
  }

  if (bestMatrix == null) {
    throw new Error("Unable to generate QR matrix.");
  }

  return bestMatrix;
};

/**
 * Generates a QR matrix for byte-mode payloads (UTF-8).
 *
 * Note: This implementation supports versions 1..10 to keep the runtime lightweight.
 */
export const generateQRCodeMatrix = (options: QRCodeMatrixOptions): Array<Array<boolean>> => {
  const value = options.value;
  if (value.length === 0) {
    throw new Error("QR value cannot be empty.");
  }

  const level = options.level ?? "M";
  const minVersion = options.minVersion ?? 1;
  const maxVersion = options.maxVersion ?? 10;

  if (minVersion > maxVersion) {
    throw new Error(`minVersion (${minVersion}) cannot be greater than maxVersion (${maxVersion}).`);
  }

  const data = utf8Encode(value);
  const version = selectVersion(data.length, level, minVersion, maxVersion);
  const codewords = createData(version, level, data);
  const matrix = chooseBestMask(version, level, codewords);

  return matrix.map((row) => row.map((valueBit) => valueBit === 1));
};
