import { describe, expect, it } from 'vitest';
import { isLocalhostHostname, isLocalhostRequest } from './localhost';

describe('localhost runtime policy', () => {
  it('accepts only the supported localhost hostnames', () => {
    expect(isLocalhostHostname('localhost')).toBe(true);
    expect(isLocalhostHostname('127.0.0.1')).toBe(true);
    expect(isLocalhostHostname('::1')).toBe(true);
    expect(isLocalhostHostname('[::1]')).toBe(true);
    expect(isLocalhostHostname('0.0.0.0')).toBe(false);
    expect(isLocalhostHostname('preview.gapwise.example')).toBe(false);
  });

  it('checks the request hostname', () => {
    expect(isLocalhostRequest(new Request('http://localhost:3000/api/dev/traces'))).toBe(true);
    expect(isLocalhostRequest(new Request('http://127.0.0.1:3000/api/dev/traces'))).toBe(true);
    expect(isLocalhostRequest(new Request('http://[::1]:3000/api/dev/traces'))).toBe(true);
    expect(isLocalhostRequest(new Request('https://preview.gapwise.example/api/dev/traces'))).toBe(false);
  });
});
