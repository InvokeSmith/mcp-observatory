/** Offline HTTP/DNS boundary for CLI subprocess tests. No request reaches the network. */
import { spyOn } from 'bun:test';
import * as dns from 'node:dns/promises';

spyOn(dns, 'resolveMx').mockResolvedValue([{ exchange: 'mail.example.com', priority: 10 }]);

const fixtureFetch = async (input: RequestInfo | URL): Promise<Response> => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  process.stdout.write(`fixture-request ${url.href}\n`);

  if (url.hostname === 'github.com') return new Response('project contact');
  if (url.hostname.endsWith('.example.com')) {
    if (url.pathname === '/.well-known/mcp-scan-optout') {
      return new Response(null, { status: 404 });
    }
    // Authentication failures must consume a limit slot, just like successful probes.
    if (url.pathname === '/mcp') return new Response(null, { status: 401 });
  }
  throw new Error(`unexpected fixture request: ${url.href}`);
};

globalThis.fetch = Object.assign(fixtureFetch, { preconnect: () => undefined });
