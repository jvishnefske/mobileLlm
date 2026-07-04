import { describe, it, expect } from 'vitest';
import { isMemoryError, loadAttempts } from '../src/llm';

describe('isMemoryError', () => {
  it('matches the iOS shared-memory failure', () => {
    expect(isMemoryError(new Error('Cannot allocate WebAssembly.Memory'))).toBe(true);
  });

  it('matches out-of-memory variants', () => {
    expect(isMemoryError(new Error('Out of memory'))).toBe(true);
    expect(isMemoryError(new Error('RangeError: WebAssembly.Memory(): could not allocate memory'))).toBe(true);
    expect(isMemoryError('OOM while initializing runtime')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isMemoryError(new Error('Failed to fetch'))).toBe(false);
    expect(isMemoryError(new Error('404 Not Found'))).toBe(false);
  });
});

describe('loadAttempts', () => {
  it('starts multi-threaded on non-iOS and degrades to single-thread, then smaller context', () => {
    const attempts = loadAttempts(false);
    expect(attempts.map((a) => a.multiThread)).toEqual([true, false, false]);
    expect(attempts[1].n_ctx).toBe(2048);
    expect(attempts[2].n_ctx).toBeLessThan(2048);
  });

  it('never tries multi-threaded when single-thread is preferred (iOS)', () => {
    const attempts = loadAttempts(true);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.every((a) => !a.multiThread)).toBe(true);
  });
});
