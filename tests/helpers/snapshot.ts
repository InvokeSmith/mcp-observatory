/**
 * A synthetic snapshot with enough shape to exercise every classifier and both honesty rules.
 *
 * Org keys are opaque by construction here, the same as in production: the derived tier never holds
 * a hostname, so a test that accidentally published one would have had to invent it.
 */
import { seal, type SealedSnapshot } from '../../src/store/seal.js';
import type { SnapshotLeaf } from '../../src/store/types.js';

function tool(
  name: string,
  description: string | null,
  properties: Record<string, unknown>,
  annotations: Record<string, unknown> | null = null,
): SnapshotLeaf['tools'][number] {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties },
    annotations,
  };
}

/** Repeated across orgs so the k-anonymity threshold is actually reached for some names. */
function commonTools(): SnapshotLeaf['tools'] {
  return [
    tool('list_invoices', 'List invoices for the authenticated account.', { limit: { type: 'number' } }, { readOnlyHint: true }),
    tool('create_invoice', 'Creates an invoice and bills the customer.', {
      account_id: { type: 'string' },
      amount: { type: 'number' },
    }),
    tool('update_settings', 'Updates workspace settings.', {
      workspaceId: { type: 'string' },
      value: { type: 'string', maxLength: 120 },
    }),
    tool('get_status', 'Get the current status.', {}, null),
  ];
}

export async function buildTestSnapshot(): Promise<SealedSnapshot> {
  const leaves: SnapshotLeaf[] = [];

  // Six organizations sharing the common tool names, so k = 5 is satisfied for those and not for
  // the unique ones added below.
  for (let i = 0; i < 6; i++) {
    leaves.push({
      targetId: `target-${String(i).padStart(3, '0')}`,
      orgKey: `org-${String(i).padStart(3, '0')}`,
      posture: i % 3 === 0 ? 'gated' : 'open',
      protocolVersion: '2025-06-18',
      serverName: 'fixture-server',
      serverVersion: '1.0.0',
      tools: commonTools(),
      toolsTruncated: false,
      http: {
        wwwAuthenticate: i % 3 === 0 ? 'Bearer' : null,
        corsAllowOrigin: i % 2 === 0 ? '*' : null,
        hasRateLimitHeaders: i % 2 === 1,
        server: 'nginx',
        cdn: null,
      },
    });
  }

  // One organization with a tool name unique to it. This is the k-anonymity case: publishing this
  // name verbatim would identify the org as surely as a hostname.
  leaves.push({
    targetId: 'target-100',
    orgKey: 'org-100',
    posture: 'open',
    protocolVersion: '2025-06-18',
    serverName: 'fixture-server',
    serverVersion: '1.0.0',
    tools: [
      tool('acme_internal_billing_refund', 'Refunds a payment. This cannot be undone.', {
        tenant_id: { type: 'string' },
        command: { type: 'string' },
      }),
      tool('run_report', 'Runs a report.', {
        sql: { type: 'string' },
        dry_run: { type: 'boolean' },
      }, { readOnlyHint: true }),
    ],
    toolsTruncated: false,
    http: {
      wwwAuthenticate: null,
      corsAllowOrigin: '*',
      hasRateLimitHeaders: false,
      server: null,
      cdn: 'cloudflare',
    },
  });

  // Incompleteness belongs in the hash, so unreached targets are leaves too.
  leaves.push({
    targetId: 'target-200',
    orgKey: 'org-200',
    posture: 'not-attempted',
    protocolVersion: null,
    serverName: null,
    serverVersion: null,
    tools: [],
    toolsTruncated: false,
    http: {
      wwwAuthenticate: null,
      corsAllowOrigin: null,
      hasRateLimitHeaders: false,
      server: null,
      cdn: null,
    },
  });

  return seal({ discoverManifestHash: 'test-discover-manifest', leaves });
}
