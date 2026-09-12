/**
 * Wilson score interval.
 *
 * Every published figure carries numerator, denominator, undetermined count and an interval. A bare
 * percentage cannot be checked and cannot be argued with, so the report linter rejects one.
 *
 * Wilson rather than the normal approximation because these proportions will often be small with
 * modest denominators, exactly where the normal approximation produces intervals that cross zero and
 * embarrass everyone.
 */

/** 97.5th percentile of the standard normal, i.e. a two-sided 95% interval. */
const Z_95 = 1.959963984540054;

export interface Proportion {
  readonly numerator: number;
  /** Decided cases only. Undetermined is reported separately, never folded into the denominator. */
  readonly denominator: number;
  readonly undetermined: number;
  readonly ciLow: number;
  readonly ciHigh: number;
}

export function wilson(numerator: number, denominator: number, undetermined = 0): Proportion {
  if (denominator === 0) {
    return { numerator, denominator, undetermined, ciLow: 0, ciHigh: 0 };
  }

  const p = numerator / denominator;
  const z2 = Z_95 * Z_95;
  const centre = p + z2 / (2 * denominator);
  const spread = Z_95 * Math.sqrt((p * (1 - p) + z2 / (4 * denominator)) / denominator);
  const divisor = 1 + z2 / denominator;

  return {
    numerator,
    denominator,
    undetermined,
    ciLow: clamp((centre - spread) / divisor),
    ciHigh: clamp((centre + spread) / divisor),
  };
}

function clamp(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Render as a fixed-point string from the integer counts.
 *
 * Deliberately not a float in the derived output: we publish counts and derive rates at render time,
 * so that a rate can never be the thing that differs byte-for-byte between two runs.
 */
export function renderRate(numerator: number, denominator: number, decimals = 1): string {
  if (denominator === 0) return 'n/a';
  const scale = 10 ** decimals;
  const scaled = Math.round((numerator / denominator) * 100 * scale);
  return (scaled / scale).toFixed(decimals);
}
