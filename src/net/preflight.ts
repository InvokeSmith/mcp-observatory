/**
 * Constraint 3, verified rather than asserted.
 *
 * The User-Agent promises a contact URL. If that URL does not resolve, the promise is worse than
 * absent: a scanner naming a project that does not exist looks like someone impersonating a research
 * project, and an operator who tries to reach us and hits a 404 has been actively misled.
 *
 * So identity is checked before probing, and failure is a refusal rather than a warning.
 */
import { resolveMx } from 'node:dns/promises';
import { realFetchRef } from './bootstrap-deny-egress.js';
import { readFile } from 'node:fs/promises';
import {
  CONTACT_EMAIL,
  CONTACT_URL,
  isPlaceholderIdentity,
  OPT_OUT_URL,
  PGP_FINGERPRINT,
  PGP_KEY_PATH,
  USER_AGENT,
} from '../config/identity.js';

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

/**
 * A published address on a domain with no MX accepts nothing. This does not prove a mailbox is
 * monitored — nothing can — but it catches the failure that actually happened: an address invented
 * for a domain that does not exist, promised in four public documents.
 */
async function mailReachable(address: string): Promise<{ url: string; ok: boolean; detail: string }> {
  const domain = address.split('@')[1];
  if (domain === undefined) {
    return { url: address, ok: false, detail: 'not an email address' };
  }
  try {
    const records = await resolveMx(domain);
    return records.length > 0
      ? { url: address, ok: true, detail: `${records.length} MX record(s)` }
      : { url: address, ok: false, detail: 'domain has no MX record' };
  } catch (error) {
    return {
      url: address,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * A fingerprint in the docs with no key in the repository is an encryption channel that does not
 * exist. This does not verify the key is usable — only that we publish what we claim to.
 */
async function keyPublished(fingerprint: string): Promise<{ url: string; ok: boolean; detail: string }> {
  try {
    const armoured = await readFile(PGP_KEY_PATH, 'utf8');
    if (!armoured.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
      return { url: PGP_KEY_PATH, ok: false, detail: 'file is not an ASCII-armoured public key' };
    }
    return {
      url: PGP_KEY_PATH,
      ok: true,
      detail: `published, fingerprint ${fingerprint.replace(/\s+/g, '').slice(-16)}`,
    };
  } catch {
    return { url: PGP_KEY_PATH, ok: false, detail: 'declared a fingerprint but published no key file' };
  }
}

export async function preflightIdentity(): Promise<PreflightResult> {
  if (isPlaceholderIdentity()) {
    return {
      ok: false,
      checks: [{ url: CONTACT_URL, ok: false, detail: 'contact URL is still a placeholder' }],
    };
  }

  const checks = await Promise.all([
    reachable(CONTACT_URL),
    reachable(OPT_OUT_URL),
    ...(CONTACT_EMAIL === null ? [] : [mailReachable(CONTACT_EMAIL)]),
    ...(PGP_FINGERPRINT === null ? [] : [keyPublished(PGP_FINGERPRINT)]),
  ]);
  return { ok: checks.every((c) => c.ok), checks };
}

export function describePreflight(result: PreflightResult): string {
  return result.checks
    .map((c) => `  ${c.ok ? 'ok  ' : 'FAIL'} ${c.url} (${c.detail})`)
    .join('\n');
}
