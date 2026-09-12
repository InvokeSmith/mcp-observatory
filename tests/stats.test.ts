import { describe, expect, test } from 'bun:test';
import { renderRate, wilson } from '../src/stats/wilson.js';

describe('wilson score interval', () => {
  test('brackets the point estimate', () => {
    const p = wilson(34, 100);
    expect(p.ciLow).toBeLessThan(0.34);
    expect(p.ciHigh).toBeGreaterThan(0.34);
  });

  test('stays inside [0,1] at the extremes, where the normal approximation does not', () => {
    const none = wilson(0, 20);
    expect(none.ciLow).toBe(0);
    expect(none.ciHigh).toBeGreaterThan(0);

    const all = wilson(20, 20);
    expect(all.ciHigh).toBe(1);
    expect(all.ciLow).toBeLessThan(1);
  });

  test('narrows as the denominator grows', () => {
    const small = wilson(5, 10);
    const large = wilson(500, 1000);
    expect(large.ciHigh - large.ciLow).toBeLessThan(small.ciHigh - small.ciLow);
  });

  test('an empty denominator is not an error and not a zero percent', () => {
    const empty = wilson(0, 0, 12);
    expect(empty.denominator).toBe(0);
    expect(renderRate(0, 0)).toBe('n/a');
  });

  test('undetermined is carried, never folded into the denominator', () => {
    const p = wilson(10, 40, 60);
    expect(p.denominator).toBe(40);
    expect(p.undetermined).toBe(60);
  });

  test('rates render from integers, identically every time', () => {
    expect(renderRate(1, 3)).toBe('33.3');
    expect(renderRate(1, 3)).toBe(renderRate(1, 3));
    expect(renderRate(34, 100)).toBe('34.0');
  });
});
