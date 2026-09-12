/**
 * The self-service opt-out check, performed before any MCP call.
 *
 * Order is the whole design: the published list costs zero contact and is consulted first, in the
 * gate. Only a host that survives that check gets one GET to `/.well-known/mcp-scan-optout`, and
 * only a host that survives *that* gets the two protocol calls.
 */
import { WELL_KNOWN_OPT_OUT_PATH } from '../config/identity.js';
import type { Gate } from './gate.js';
import { interpretWellKnown, type OptOutDecision } from './optout.js';
import { TargetTicket } from './ticket.js';

/** A tiny cap: an opt-out document is a few dozen bytes, and we do not need to read a novel. */
const MAX_OPT_OUT_BODY_BYTES = 64 * 1024;

export function wellKnownTicket(targetId: string, origin: string): TargetTicket {
  return new TargetTicket(
    targetId,
    origin,
    WELL_KNOWN_OPT_OUT_PATH,
    'well-known-optout',
    new Set(['GET']),
    // One request, plus headroom for a same-domain redirect. Not a budget for retrying a refusal.
    2,
  );
}

export async function checkWellKnownOptOut(gate: Gate, targetId: string, origin: string): Promise<OptOutDecision> {
  const ticket = wellKnownTicket(targetId, origin);

  let response: Response;
  try {
    response = await gate.fetch(ticket, `${origin}${WELL_KNOWN_OPT_OUT_PATH}`, { method: 'GET' });
  } catch (error) {
    // A timeout, a DNS failure, a refusal — we do not know what the operator wants. A flaky server
    // is not consent, so this is deferred rather than treated as permission.
    return { kind: 'undetermined', reason: error instanceof Error ? error.message : String(error) };
  }

  const contentType = response.headers.get('content-type');
  let body = '';
  try {
    const text = await response.text();
    body = text.slice(0, MAX_OPT_OUT_BODY_BYTES);
  } catch {
    return { kind: 'undetermined', reason: 'response body could not be read' };
  }

  return interpretWellKnown(response.status, contentType, body);
}
