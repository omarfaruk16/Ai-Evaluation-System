import { describe, expect, it } from 'vitest';
import { generateApiKey, openApiKey, sealApiKey } from '../../src/auth/api-key';
import { open, seal } from '../../src/common/secret-box';

const SECRET = 'x'.repeat(40);

describe('secret box', () => {
  it('round-trips a value', () => {
    const sealed = seal('hello', SECRET, 'p');
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(open(sealed, SECRET, 'p')).toBe('hello');
  });

  it('uses a fresh IV each time', () => {
    expect(seal('hello', SECRET, 'p')).not.toBe(seal('hello', SECRET, 'p'));
  });

  it('returns null for a wrong key, wrong purpose or tampered value', () => {
    const sealed = seal('hello', SECRET, 'p');
    expect(open(sealed, 'y'.repeat(40), 'p')).toBeNull();
    expect(open(sealed, SECRET, 'other')).toBeNull();
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(open(parts.join('.'), SECRET, 'p')).toBeNull();
    expect(open('garbage', SECRET, 'p')).toBeNull();
  });
});

describe('stored API keys', () => {
  it('seals a key only when an encryption key is configured', () => {
    const { key } = generateApiKey();
    expect(sealApiKey(key, undefined)).toBeNull();
    const sealed = sealApiKey(key, SECRET);
    expect(sealed).not.toContain(key);
    expect(openApiKey(sealed!, SECRET)).toBe(key);
  });
});
