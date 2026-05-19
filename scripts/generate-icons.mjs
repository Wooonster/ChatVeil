import { readFileSync } from 'node:fs';

const requiredIcons = [16, 32, 48, 128, 512];
const iconDir = new URL('../public/icons/', import.meta.url);

function readPngSize(path) {
  const png = readFileSync(path);
  const signature = png.subarray(0, 8).toString('hex');
  if (signature !== '89504e470d0a1a0a') {
    throw new Error(`${path.pathname} is not a PNG file.`);
  }
  return {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
}

for (const size of requiredIcons) {
  const path = new URL(`icon${size}.png`, iconDir);
  const dimensions = readPngSize(path);
  if (dimensions.width !== size || dimensions.height !== size) {
    throw new Error(
      `icon${size}.png must be ${size}x${size}, got ${dimensions.width}x${dimensions.height}.`,
    );
  }
}

console.log(`Validated icon assets: ${requiredIcons.map((size) => `icon${size}.png`).join(', ')}`);
