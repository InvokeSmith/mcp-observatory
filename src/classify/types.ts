/**
 * Every classifier in this project is tri-state.
 *
 * A classifier that forces a binary is producing fiction: an MCP tool with no annotations, a neutral
 * name and no description genuinely does not tell you whether it writes. Recording that as "no"
 * would quietly inflate the read side of every denominator. So `undetermined` is a first-class
 * answer and its rate is published beside every statistic.
 */

export type Trit = 'yes' | 'no' | 'undetermined';

/** Which signal decided, so a report can say how it knows and a reader can discount accordingly. */
export type DecidedBy = 'annotation' | 'name' | 'description' | 'schema' | 'absent' | null;

export interface Determination {
  readonly value: Trit;
  readonly decidedBy: DecidedBy;
  /** Short, quotable, and derived — never a verbatim description. Constraint 6. */
  readonly evidence: string;
}

export function determined(value: Trit, decidedBy: DecidedBy, evidence: string): Determination {
  return { value, decidedBy, evidence };
}

export const UNDETERMINED: Determination = {
  value: 'undetermined',
  decidedBy: null,
  evidence: 'no signal',
};

/**
 * Split an identifier into lowercase tokens, so `refundPayment`, `refund_payment`,
 * `refund-payment` and `payments.refund` all yield a `refund` token.
 */
export function tokenize(identifier: string): readonly string[] {
  return identifier
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .flatMap((part) => part.split(/\s+/))
    .filter((part) => part !== '')
    .map((part) => part.toLowerCase());
}

/** Normalized parameter key: `accountId`, `account-id`, `account.id` -> `account_id`. */
export function normalizeParamName(name: string): string {
  return tokenize(name).join('_');
}

/** First sentence only. Later sentences routinely describe what the caller may do next. */
export function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^[\s\S]*?[.!?](\s|$)/.exec(trimmed);
  return (match?.[0] ?? trimmed).trim();
}
