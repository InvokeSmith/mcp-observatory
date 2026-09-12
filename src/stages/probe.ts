/**
 * Stage 2. Exactly two protocol calls per host, and never before the opt-out question is settled.
 *
 * The sequence is the constraint:
 *
 *   published list (zero contact, in the gate)
 *     -> /.well-known/mcp-scan-optout (one GET)
 *       -> initialize
 *         -> tools/list
 *
 * Anything that ends the sequence early produces a posture and stops. There is no branch that
 * retries, escalates, or tries a different door.
 */
import { ProbeClient } from '../mcp/probe-client.js';
import { checkWellKnownOptOut } from '../net/optout-check.js';
import { GateRefusal } from '../net/errors.js';
import { TargetTicket } from '../net/ticket.js';
import type { Gate } from '../net/gate.js';
import type { HostState } from '../net/host-state.js';
import type { AuthPosture, HttpMetadata, ObservedToolRecord, SnapshotLeaf } from '../store/types.js';

export interface ProbeTarget {
  readonly targetId: string;
  readonly orgKey: string;
  readonly origin: string;
  readonly path: string;
}

export interface ProbeOutcome {
  readonly leaf: SnapshotLeaf;
  readonly requestCount: number;
  readonly error: string | null;
}

/** initialize + tools/list, plus the pages of a paginated listing, plus a little headroom. */
const MCP_REQUEST_BUDGET = 16;

function emptyHttpMetadata(): HttpMetadata {
  return {
    wwwAuthenticate: null,
    corsAllowOrigin: null,
    hasRateLimitHeaders: false,
    server: null,
    cdn: null,
  };
}

/** Everything obtainable without authenticating, read off the captures the gate already recorded. */
function httpMetadataFrom(gate: Gate, targetId: string): HttpMetadata {
  const captures = gate.capturesFor(targetId);
  const last = captures.at(-1);
  if (last === undefined) return emptyHttpMetadata();

  const headers = new Map(last.responseHeaders);
  const has = (name: string): string | null => headers.get(name) ?? null;

  return {
    wwwAuthenticate: has('www-authenticate'),
    corsAllowOrigin: has('access-control-allow-origin'),
    hasRateLimitHeaders:
      headers.has('ratelimit-limit') || headers.has('x-ratelimit-limit') || headers.has('retry-after'),
    server: has('server'),
    cdn: has('cf-ray') !== null ? 'cloudflare' : has('x-amz-cf-id') !== null ? 'cloudfront' : null,
  };
}

function leafFor(
  target: ProbeTarget,
  posture: AuthPosture,
  http: HttpMetadata,
  extras: Partial<SnapshotLeaf> = {},
): SnapshotLeaf {
  return {
    targetId: target.targetId,
    orgKey: target.orgKey,
    posture,
    protocolVersion: null,
    serverName: null,
    serverVersion: null,
    tools: [],
    toolsTruncated: false,
    http,
    ...extras,
  };
}

export async function probeTarget(
  gate: Gate,
  hostState: HostState,
  target: ProbeTarget,
): Promise<ProbeOutcome> {
  const host = new URL(target.origin).hostname;

  // 1. The self-service opt-out, before any MCP call.
  const decision = await checkWellKnownOptOut(gate, target.targetId, target.origin);

  if (decision.kind === 'opted-out') {
    await hostState.noteTerminal(host, 'opted-out', Date.now());
    return {
      leaf: leafFor(target, 'opted-out', httpMetadataFrom(gate, target.targetId)),
      requestCount: gate.capturesFor(target.targetId).length,
      error: null,
    };
  }

  if (decision.kind === 'undetermined') {
    // Deferred. Neither probed nor counted as opted out — a flaky server is not consent, and the
    // deferred count is published so the sample's incompleteness stays visible.
    return {
      leaf: leafFor(target, 'optout-undetermined', httpMetadataFrom(gate, target.targetId)),
      requestCount: gate.capturesFor(target.targetId).length,
      error: decision.reason,
    };
  }

  // 2. The two protocol calls.
  const ticket = new TargetTicket(
    target.targetId,
    target.origin,
    target.path,
    'mcp-probe',
    new Set(['POST', 'GET', 'DELETE']),
    MCP_REQUEST_BUDGET,
  );

  const client = ProbeClient.create(gate, ticket);

  let initialized = false;
  try {
    const initialize = await client.initialize();
    initialized = true;

    const listed = await client.listTools();
    await client.close();

    return {
      leaf: leafFor(target, 'open', httpMetadataFrom(gate, target.targetId), {
        protocolVersion: initialize.protocolVersion,
        serverName: initialize.serverInfo.name,
        serverVersion: initialize.serverInfo.version,
        tools: listed.tools.map(toRecord),
        toolsTruncated: listed.truncated,
      }),
      requestCount: gate.capturesFor(target.targetId).length,
      error: null,
    };
  } catch (error) {
    await client.close().catch(() => undefined);

    const message = error instanceof Error ? error.message : String(error);
    const hitAuthWall =
      ticket.terminal === 'auth-wall' || hostState.terminalFor(host) === 'auth-wall';

    // initialize worked and listing did not: the server is telling us it has tools but will not show
    // them without credentials. That is a distinct fact from "the whole endpoint is gated".
    const posture: AuthPosture = hitAuthWall
      ? initialized
        ? 'partial'
        : 'gated'
      : error instanceof GateRefusal
        ? 'not-attempted'
        : 'unreachable';

    return {
      leaf: leafFor(target, posture, httpMetadataFrom(gate, target.targetId)),
      requestCount: gate.capturesFor(target.targetId).length,
      error: message,
    };
  }
}

function toRecord(tool: {
  name: string;
  description?: string | undefined;
  inputSchema?: unknown;
  annotations?: unknown;
}): ObservedToolRecord {
  return {
    name: tool.name,
    description: tool.description ?? null,
    inputSchema:
      typeof tool.inputSchema === 'object' && tool.inputSchema !== null
        ? (tool.inputSchema as Record<string, unknown>)
        : null,
    annotations:
      typeof tool.annotations === 'object' && tool.annotations !== null
        ? (tool.annotations as Record<string, unknown>)
        : null,
  };
}
