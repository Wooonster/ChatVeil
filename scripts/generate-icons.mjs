import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

const sizes = [16, 32, 48, 128];
const outputDir = new URL('../public/icons/', import.meta.url);

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let index = 0; index < 8; index += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, payload) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])));
  return Buffer.concat([length, typeBuffer, payload, crc]);
}

function rgbaAt(x, y, size) {
  const inset = Math.round(size * 0.14);
  const lineHeight = Math.max(2, Math.round(size * 0.12));
  const lineGap = Math.max(3, Math.round(size * 0.12));
  const lineStart = Math.round(size * 0.26);
  const inPanel = x >= inset && x < size - inset && y >= inset && y < size - inset;
  if (!inPanel) return [0, 0, 0, 0];

  const radius = Math.round(size * 0.12);
  const dx = x < inset + radius ? inset + radius - x : x >= size - inset - radius ? x - (size - inset - radius - 1) : 0;
  const dy = y < inset + radius ? inset + radius - y : y >= size - inset - radius ? y - (size - inset - radius - 1) : 0;
  if (dx * dx + dy * dy > radius * radius) return [0, 0, 0, 0];

  const lineIndex = Math.floor((y - lineStart) / (lineHeight + lineGap));
  const lineTop = lineStart + lineIndex * (lineHeight + lineGap);
  const inLine = lineIndex >= 0 && lineIndex < 3 && y >= lineTop && y < lineTop + lineHeight;
  if (inLine && x >= Math.round(size * 0.26) && x < Math.round(size * (lineIndex === 1 ? 0.7 : 0.78))) {
    return [255, 255, 255, 255];
  }

  return [18, 64, 92, 255];
}

function makePng(size) {
  const header = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const rowOffset = y * (size * 4 + 1);
    raw[rowOffset] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = rgbaAt(x, y, size);
      const offset = rowOffset + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }

  return Buffer.concat([
    header,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(outputDir, { recursive: true });
for (const size of sizes) {
  writeFileSync(new URL(`icon-${size}.png`, outputDir), makePng(size));
}
