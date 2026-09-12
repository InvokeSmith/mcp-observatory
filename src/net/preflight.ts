/**
 * Constraint 3, verified rather than asserted.
 *
 * The User-Agent promises a contact URL. If that URL does not resolve, the promise is worse than
 * absent: a scanner naming a project that does not exist looks like someone impersonating a research
 * project, and an operator who tries to reach us and hits a 404 has been actively misled.
 *
 * So identity is checked before probing, and failure is a refusal rather than a warning.
 */
import { realFetchRef } from './bootstrap-deny-egress.js';
import { CONTACT_URL, isPlaceholderIdentity, OPT_OUT_URL, USER_AGENT } from '../config/identity.js';

export interface PreflightResult {
  readonly ok: boolean;
  readonly checks: readonly { readonly url: string; readonly ok: boolean; readonly detail: string }[];
}

async function reachable(url: string): Promise<{ url: string; ok: boolean; detail: string }> {
  try {
    const response = await realFetchRef()(url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT },
      redirect: 'follow',
    });
    return {
      url,
      ok: response.status >= 200 && response.status < 400,
      detail: `HTTP ${response.status}`,
    };
  } catch (error) {
    return { url, ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
}

export async function preflightIdentity(): Promise<PreflightResult> {
  if (isPlaceholderIdentity()) {
    return {
      ok: false,
      checks: [{ url: CONTACT_URL, ok: false, detail: 'contact URL is still a placeholder' }],
    };
  }

  const checks = await Promise.all([reachable(CONTACT_URL), reachable(OPT_OUT_URL)]);
  return { ok: checks.every((c) => c.ok), checks };
}

export function describePreflight(result: PreflightResult): string {
  return result.checks
    .map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.url} (${c.detail})`)
    .join('\n');
}
