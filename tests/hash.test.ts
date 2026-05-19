import { describe, expect, it } from 'vitest';
import { hashStableKey } from '../src/core/hash';

describe('stable key hashing', () => {
  it('returns deterministic sha256-prefixed unlock keys', async () => {
    const first = await hashStableKey('chatgpt.com:/c/abc');
    const second = await hashStableKey('chatgpt.com:/c/abc');
    const other = await hashStableKey('chatgpt.com:/c/other');
    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:/);
    expect(first).not.toBe(other);
  });
});
