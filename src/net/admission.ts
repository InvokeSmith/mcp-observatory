/**
 * Self-protection. The gate's other job.
 *
 * Targets arrive from certificate-transparency logs, public registries and redirects, so a target
 * URL is partly attacker-influenced. Without an admission policy a scanner that politely follows
 * what it is told becomes a reflector: point it at `http://169.254.169.254/` and it fetches cloud
 * credentials on someone's behalf.
 */

export type AdmissionVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

const ALLOWED_PORTS = new Set(['', '443']);

/** RFC1918, loopback, link-local, CGNAT, ULA, and the unspecified addresses. */
export function isPrivateAddress(address: string): boolean {
  const addr = address.toLowerCase().replace(/^\[|\]$/g, '');

  if (addr === '::1' || addr === '::' || addr === '0.0.0.0') return true;
  if (addr.startsWith('fe80:') || addr.startsWith('fc') || addr.startsWith('fd')) return true;
  // IPv4-mapped IPv6, e.g. ::ffff:10.0.0.1
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(addr);
  const v4 = mapped?.[1] ?? addr;

  const octets = v4.split('.');
  if (octets.length !== 4) return false;
  const nums = octets.map((o) => Number(o));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;

  const [a = 0, b = 0] = nums;
  if (a === 10 || a === 127 || a === 0) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a >= 224) return true; // multicast and reserved
  return false;
}

export interface AdmissionOptions {
  /** Loopback is inadmissible in production and required for fixtures, so it is an explicit switch. */
  readonly allowLoopback?: boolean;
  readonly allowHttp?: boolean;
}

export function admitTarget(url: URL, options: AdmissionOptions = {}): AdmissionVerdict {
  if (url.protocol !== 'https:' && !(options.allowHttp === true && url.protocol === 'http:')) {
    return { ok: false, reason: `scheme ${url.protocol} is not https` };
  }

  if (!ALLOWED_PORTS.has(url.port) && options.allowLoopback !== true) {
    return { ok: false, reason: `port ${url.port} is not in the allowlist` };
  }

  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'URL carries embedded credentials' };
  }

  const host = url.hostname;
  const looksLikeIp = /^\[?[0-9a-f:.]+\]?$/i.test(host) && /[.:]/.test(host);

  if (options.allowLoopback === true) {
    return { ok: true };
  }

  if (looksLikeIp && isPrivateAddress(host)) {
    return { ok: false, reason: `${host} is not a public unicast address` };
  }

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    return { ok: false, reason: `${host} is a local name` };
  }

  return { ok: true };
}
