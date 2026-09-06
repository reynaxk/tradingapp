import { describe, expect, it } from 'vitest';
import { isEvmAddress, normalizeEvmAddress } from './wallet';

describe('isEvmAddress', () => {
  it('accepts a well-formed 0x + 40 hex char address', () => {
    expect(isEvmAddress('0x4200000000000000000000000000000000000006')).toBe(true);
  });

  it('accepts mixed-case (checksummed) hex digits', () => {
    expect(isEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(true);
  });

  it('rejects an address missing the 0x prefix', () => {
    expect(isEvmAddress('4200000000000000000000000000000000000006')).toBe(false);
  });

  it('rejects an address with too few hex characters', () => {
    expect(isEvmAddress('0x000000000000000000000000000000000000dEaD'.slice(0, -1))).toBe(false);
  });

  it('rejects an address with too many hex characters', () => {
    expect(isEvmAddress('0x000000000000000000000000000000000000dEaD0')).toBe(false);
  });

  it('rejects a non-hex string', () => {
    expect(isEvmAddress('0xnotAnAddressGGGGGGGGGGGGGGGGGGGGGGGGGGGG')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isEvmAddress('')).toBe(false);
  });
});

describe('normalizeEvmAddress', () => {
  it('lowercases a mixed-case address', () => {
    expect(normalizeEvmAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')).toBe(
      '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    );
  });

  it('is idempotent on an already-lowercase address', () => {
    const lower = '0x4200000000000000000000000000000000000006';
    expect(normalizeEvmAddress(lower)).toBe(lower);
  });
});
