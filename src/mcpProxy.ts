/*
 * MCP CORS proxy.
 *
 * Browsers can't POST to most external MCP servers directly — those servers
 * rarely send Access-Control-Allow-Origin, and the spec even tells them to
 * validate Origin (DNS-rebinding defence). So the web editor routes MCP
 * JSON-RPC through this same-origin endpoint: the browser POSTs
 * { url, headers?, body } here, we forward it server-side (no CORS), and return
 * the reply. The editor's HttpMcpTransport can point at this instead of the
 * target URL.
 *
 * SSRF note: the target URL is USER-configured in the editor's MCP settings (not
 * model-controlled), and this is a single-tenant self-host. We still block
 * localhost / private-range literals + non-http(s) schemes as a basic guard.
 */

import type { FastifyInstance } from 'fastify';

interface McpProxyBody {
  url: string;
  headers?: Record<string, string>;
  body: string;
}

const PRIVATE_HOST = /^(localhost|127\.|0\.0\.0\.0|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?fc|\[?fd)/i;

/** True when the URL is safe to proxy: http(s) + not an obvious private host. */
export function isProxyableUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  if (PRIVATE_HOST.test(u.hostname)) return false;
  return true;
}

export function registerMcpProxyRoute(app: FastifyInstance): void {
  app.post('/api/mcp-proxy', async (req, reply) => {
    const { url, headers, body } = (req.body ?? {}) as Partial<McpProxyBody>;
    if (typeof url !== 'string' || typeof body !== 'string') {
      return reply.code(400).send({ error: 'url and body are required' });
    }
    if (!isProxyableUrl(url)) {
      return reply.code(400).send({ error: 'url must be a public http(s) endpoint' });
    }

    const forwardHeaders: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    for (const [k, v] of Object.entries(headers ?? {})) {
      // Only forward safe, caller-supplied auth/content headers.
      const key = k.toLowerCase();
      if (key === 'authorization' || key === 'mcp-session-id' || key === 'mcp-protocol-version') {
        forwardHeaders[key] = String(v);
      }
    }

    const ctl = new AbortController();
    const timeout = setTimeout(() => ctl.abort(), 30_000);
    try {
      const upstream = await fetch(url, {
        method: 'POST',
        headers: forwardHeaders,
        body,
        signal: ctl.signal,
      });
      const text = await upstream.text();
      const sid = upstream.headers.get('mcp-session-id');
      if (sid) reply.header('mcp-session-id', sid);
      return reply
        .code(upstream.status)
        .header('content-type', upstream.headers.get('content-type') ?? 'application/json')
        .send(text);
    } catch (err) {
      return reply.code(502).send({ error: `mcp upstream failed: ${String(err)}` });
    } finally {
      clearTimeout(timeout);
    }
  });
}
