const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fallbackHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export async function hashStableKey(input: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return `sha256:${fallbackHash(input)}`;
  const digest = await subtle.digest('SHA-256', encoder.encode(input));
  return `sha256:${toHex(digest)}`;
}
