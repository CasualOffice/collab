/*
 * Copyright (c) 2026 Casual Office. All rights reserved.
 *
 * POST /api/ai/chat — thin Anthropic proxy.
 *
 * Forwards a messages-API call to Anthropic and streams the response
 * back to the client. The client's tool loop continues to run in the
 * browser (DocsBridge); this endpoint only removes the need for every
 * user to paste an API key into the editor.
 *
 * Auth: the endpoint is gated by the room auth rules. In personal mode
 * the caller must carry a valid session cookie (same as every other
 * /api/* route). In anonymous mode the endpoint is open, so only
 * deploy with ANTHROPIC_API_KEY set when you trust your network.
 *
 * The caller may pass their own `apiKey` in the request body as an
 * escape hatch (BYO-key mode). The server key takes precedence when
 * both are present so an unprivileged caller can't use the field to
 * exfiltrate the server key via a crafted upstream request.
 */

import type { FastifyInstance } from 'fastify';

interface AiChatBody {
  model?: string;
  system?: string;
  messages: unknown;
  tools?: unknown;
  max_tokens?: number;
  /** Optional BYO API key — only used when no server key is configured. */
  apiKey?: string;
}

export function registerAiRoutes(
  app: FastifyInstance,
  opts: { rateLimitEnabled: boolean; rateLimitPerMin: number },
): void {
  app.post<{ Body: AiChatBody }>(
    '/api/ai/chat',
    {
      config: opts.rateLimitEnabled
        ? { rateLimit: { max: opts.rateLimitPerMin, timeWindow: '1 minute' } }
        : {},
    },
    async (req, reply) => {
      const body = req.body as AiChatBody;

      // Server key wins; fall back to caller-supplied key (BYO mode).
      const apiKey = process.env.ANTHROPIC_API_KEY ?? body.apiKey ?? null;
      if (!apiKey) {
        return reply.code(503).send({
          error: 'no_api_key',
          hint: 'Set ANTHROPIC_API_KEY on the server or supply apiKey in the request body.',
        });
      }

      const payload = {
        model: body.model ?? 'claude-haiku-4-5-20251001',
        max_tokens: body.max_tokens ?? 4096,
        ...(body.system ? { system: body.system } : {}),
        messages: body.messages,
        ...(body.tools ? { tools: body.tools } : {}),
      };

      let upstream: Response;
      try {
        upstream = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
        });
      } catch (err) {
        req.log.warn({ err }, 'docops: upstream Anthropic fetch failed');
        return reply.code(502).send({ error: 'upstream_error', detail: String(err) });
      }

      // Forward the status + body verbatim — the client parses the
      // Anthropic envelope directly, so no re-shaping needed.
      const data = await upstream.json();
      return reply.code(upstream.status).send(data);
    },
  );
}
