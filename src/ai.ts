/*
 * Copyright (c) 2026 Casual Office. All rights reserved.
 *
 * POST /api/ai/chat — generic LLM proxy.
 *
 * Forwards the request body verbatim to whatever LLM endpoint the
 * operator configures. The client (DocOpsPanel) constructs the correct
 * request shape for its chosen provider; this endpoint only adds
 * server-side auth and removes the need for users to manage keys.
 *
 * Environment variables:
 *   LLM_ENDPOINT        Full URL to POST to.
 *                       Default: https://api.anthropic.com/v1/messages
 *                       Examples:
 *                         https://api.openai.com/v1/chat/completions
 *                         http://localhost:11434/v1/chat/completions  (Ollama)
 *                         https://api.groq.com/openai/v1/chat/completions
 *
 *   LLM_API_KEY         Server-side key injected into every request.
 *                       Falls back to ANTHROPIC_API_KEY for convenience.
 *
 *   LLM_API_KEY_HEADER  Header name for the key.
 *                       Default: x-api-key  (Anthropic)
 *                       Use: Authorization  (OpenAI / Ollama / Groq — value
 *                       will be sent as "Bearer <key>")
 *
 *   LLM_EXTRA_HEADERS   JSON object of additional headers to inject.
 *                       Example: {"anthropic-version":"2023-06-01"}
 *
 * BYO-key fallback: if no server key is configured, the caller may
 * supply `apiKey` + optionally `apiKeyHeader` in the request body.
 * The server key always takes precedence.
 */

import type { FastifyInstance } from 'fastify';

interface AiChatBody {
  /** Full request body forwarded verbatim to the upstream LLM. */
  [key: string]: unknown;
  /** BYO key — only used when no server key is configured. */
  apiKey?: string;
  /** BYO key header name — e.g. "Authorization". Ignored when server key is set. */
  apiKeyHeader?: string;
}

// Read config once at module load so the hot path is just a lookup.
const LLM_ENDPOINT =
  process.env.LLM_ENDPOINT ?? 'https://api.anthropic.com/v1/messages';
const SERVER_KEY = process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? null;
const KEY_HEADER = process.env.LLM_API_KEY_HEADER ?? 'x-api-key';
const EXTRA_HEADERS: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.LLM_EXTRA_HEADERS ?? '{}');
  } catch {
    return {};
  }
})();

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
      const body = { ...(req.body as AiChatBody) };

      // Determine which key + header to use.
      const key = SERVER_KEY ?? body.apiKey ?? null;
      if (!key) {
        return reply.code(503).send({
          error: 'no_api_key',
          hint: 'Set LLM_API_KEY on the server, or supply apiKey in the request body.',
        });
      }
      const keyHeader = SERVER_KEY ? KEY_HEADER : (body.apiKeyHeader ?? KEY_HEADER);

      // Strip client-only fields before forwarding.
      delete body.apiKey;
      delete body.apiKeyHeader;

      // Build auth header value. OpenAI / Ollama / Groq expect "Bearer <key>";
      // Anthropic expects the raw key. Use "Bearer" when the header is Authorization.
      const keyValue =
        keyHeader.toLowerCase() === 'authorization' ? `Bearer ${key}` : key;

      const headers: Record<string, string> = {
        'content-type': 'application/json',
        [keyHeader]: keyValue,
        ...EXTRA_HEADERS,
      };

      let upstream: Response;
      try {
        upstream = await fetch(LLM_ENDPOINT, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (err) {
        req.log.warn({ err, endpoint: LLM_ENDPOINT }, 'docops: upstream LLM fetch failed');
        return reply.code(502).send({ error: 'upstream_error', detail: String(err) });
      }

      // Forward status + body verbatim — the client owns response parsing.
      const data = await upstream.json();
      return reply.code(upstream.status).send(data);
    },
  );
}
