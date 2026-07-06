/*
 * AI WebSocket endpoint — DocOps LLM orchestration.
 *
 * The SERVER holds the full LLM tool loop. When the LLM requests a tool
 * call the server sends it back down to the originating client over the
 * same WebSocket; the client executes it via DocsBridge and returns the
 * result. Other room members see only the resulting Yjs edits, never the
 * orchestration traffic.
 *
 * Protocol (per-connection):
 *
 *   Client → Server:
 *     { type:'chat', model, max_tokens, system, messages, tools, apiKey? }
 *     { type:'tool_result', id: string, result: unknown, error?: string }
 *
 *   Server → Client:
 *     { type:'tool_call', id: string, toolName: string, args: object }
 *     { type:'text', text: string }
 *     { type:'done', history: LlmMessage[] }
 *     { type:'error', message: string }
 *
 * LLM configuration (env vars):
 *   LLM_ENDPOINT        Full POST URL. Default: https://api.anthropic.com/v1/messages
 *                       Examples: https://api.openai.com/v1/chat/completions
 *                                 http://localhost:11434/v1/chat/completions (Ollama)
 *   LLM_API_KEY         Server-side key. Falls back to ANTHROPIC_API_KEY.
 *   LLM_API_KEY_HEADER  Header name. Default: x-api-key (Anthropic).
 *                       Use: Authorization for OpenAI / Ollama / Groq.
 *   LLM_EXTRA_HEADERS   JSON object of extra headers to inject.
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { IncomingMessage, Server } from "node:http";

// ── LLM config (read once at startup) ─────────────────────────────────────

const LLM_ENDPOINT =
  process.env.LLM_ENDPOINT ?? "https://api.anthropic.com/v1/messages";
const SERVER_KEY =
  process.env.LLM_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? null;
const KEY_HEADER = process.env.LLM_API_KEY_HEADER ?? "x-api-key";
const EXTRA_HEADERS: Record<string, string> = (() => {
  try {
    return JSON.parse(process.env.LLM_EXTRA_HEADERS ?? "{}") as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
})();

const MAX_TOOL_ROUNDS = 12;

// ── Wire types ────────────────────────────────────────────────────────────

type LlmContentBlock =
  | { type: "text"; text: string }
  | {
      type: "tool_use";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { type: "tool_result"; tool_use_id: string; content: string };

interface LlmMessage {
  role: "user" | "assistant";
  content: LlmContentBlock[] | string;
}

interface ChatInitMsg {
  type: "chat";
  model: string;
  max_tokens: number;
  system: string;
  messages: LlmMessage[];
  tools: unknown;
  apiKey?: string;
  /** Hocuspocus room name — used to broadcast AI presence to collaborators. */
  roomName?: string;
  /** Maximum tool-call rounds before the loop is stopped. Defaults to MAX_TOOL_ROUNDS. */
  maxToolRounds?: number;
  /**
   * When true, the server runs ONE model turn and returns { type:'round',
   * content, stop_reason } — the client drives the tool loop. Enables the
   * client-side agent on the web. Omitted → the legacy server-driven loop.
   */
  singleRound?: boolean;
}

interface LlmApiResponse {
  content: LlmContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence";
  error?: { message: string };
}

// ── LLM HTTP call ──────────────────────────────────────────────────────────

async function callLlm(opts: {
  model: string;
  max_tokens: number;
  system: string;
  messages: LlmMessage[];
  tools: unknown;
  key: string;
}): Promise<
  { ok: false; message: string } | { ok: true; data: LlmApiResponse }
> {
  const keyValue =
    KEY_HEADER.toLowerCase() === "authorization"
      ? `Bearer ${opts.key}`
      : opts.key;

  let resp: Response;
  try {
    resp = await fetch(LLM_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [KEY_HEADER]: keyValue,
        ...EXTRA_HEADERS,
      },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: opts.max_tokens,
        system: opts.system,
        messages: opts.messages,
        tools: opts.tools,
      }),
    });
  } catch (err) {
    return { ok: false, message: `upstream fetch failed: ${String(err)}` };
  }

  let data: LlmApiResponse;
  try {
    data = (await resp.json()) as LlmApiResponse;
  } catch {
    return {
      ok: false,
      message: `upstream response not JSON (status ${resp.status})`,
    };
  }

  if (!resp.ok) {
    return {
      ok: false,
      message: data.error?.message ?? `upstream error ${resp.status}`,
    };
  }

  return { ok: true, data };
}

// ── Connection handler ────────────────────────────────────────────────────

// ── Presence helpers ─────────────────────────────────────────────────────────

type HocuspocusDocuments = Map<
  string,
  { broadcastStateless(payload: string): void }
>;

function broadcastAiStatus(
  docs: HocuspocusDocuments | null,
  roomName: string | undefined,
  status: "thinking" | "idle",
) {
  if (!docs || !roomName) return;
  const doc = docs.get(roomName);
  if (!doc) return;
  try {
    doc.broadcastStateless(JSON.stringify({ type: "ai-status", status }));
  } catch {
    /* ignore — room may have drained between start and broadcast */
  }
}

// ── Connection handler ────────────────────────────────────────────────────

function handleAiConnection(ws: WebSocket, docs: HocuspocusDocuments | null) {
  // In-flight tool calls: tool_use id → resolver
  const pendingToolResults = new Map<
    string,
    (result: unknown, error: string | undefined) => void
  >();

  ws.on("message", (raw) => {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw.toString()) as Record<string, unknown>;
    } catch {
      wsSend(ws, { type: "error", message: "invalid JSON" });
      ws.close();
      return;
    }

    if (msg.type === "chat") {
      const init = msg as unknown as ChatInitMsg;
      // singleRound: the CLIENT drives the tool loop (server is just a
      // key-holding LLM proxy for one round) — this is what lets the agentic
      // plan→execute→reflect loop run on the web, where it previously couldn't
      // because the server drove the whole loop. Otherwise, the legacy path where
      // the server drives the loop and routes tool_call frames back.
      const run = init.singleRound
        ? runSingleRound(ws, init, docs)
        : runLlmLoop(ws, init, pendingToolResults, docs);
      run.catch((err) => {
        try {
          wsSend(ws, { type: "error", message: String(err) });
          ws.close();
        } catch {
          /* already closed */
        }
      });
    } else if (msg.type === "tool_result") {
      const id = msg.id as string;
      const resolve = pendingToolResults.get(id);
      if (resolve) {
        pendingToolResults.delete(id);
        resolve(msg.result, msg.error as string | undefined);
      }
    }
  });

  ws.on("error", () => {
    for (const [, resolve] of pendingToolResults) {
      resolve(null, "connection closed");
    }
    pendingToolResults.clear();
  });
}

function wsSend(ws: WebSocket, payload: Record<string, unknown>) {
  try {
    ws.send(JSON.stringify(payload));
  } catch {
    /* ignore sends on a closing socket */
  }
}

/**
 * Single LLM round — the server is a key-holding proxy for ONE model turn and
 * the CLIENT drives the tool loop (executes tools, sends the next round). This
 * is what makes the client-side agent (plan→execute→reflect) work on the web:
 * the panel calls this per round, exactly like DirectTransport/DesktopTransport.
 */
async function runSingleRound(
  ws: WebSocket,
  init: ChatInitMsg,
  docs: HocuspocusDocuments | null,
): Promise<void> {
  const key = SERVER_KEY ?? init.apiKey ?? null;
  if (!key) {
    wsSend(ws, { type: "error", message: "no_api_key" });
    ws.close();
    return;
  }

  broadcastAiStatus(docs, init.roomName, "thinking");
  const result = await callLlm({
    model: init.model,
    max_tokens: init.max_tokens,
    system: init.system,
    messages: init.messages,
    tools: init.tools,
    key,
  });
  broadcastAiStatus(docs, init.roomName, "idle");

  if (!result.ok) {
    wsSend(ws, { type: "error", message: result.message });
    ws.close();
    return;
  }

  const { data } = result;
  for (const block of data.content) {
    if (block.type === "text" && block.text.trim()) {
      wsSend(ws, { type: "text", text: block.text });
    }
  }
  // The client reads content (incl. native tool_use blocks) + stop_reason and
  // drives the next round itself.
  wsSend(ws, {
    type: "round",
    content: data.content,
    stop_reason: data.stop_reason,
  });
  ws.close();
}

async function runLlmLoop(
  ws: WebSocket,
  init: ChatInitMsg,
  pendingToolResults: Map<
    string,
    (result: unknown, error: string | undefined) => void
  >,
  docs: HocuspocusDocuments | null,
): Promise<void> {
  const key = SERVER_KEY ?? init.apiKey ?? null;
  if (!key) {
    wsSend(ws, { type: "error", message: "no_api_key" });
    ws.close();
    return;
  }

  broadcastAiStatus(docs, init.roomName, "thinking");

  const maxRounds =
    typeof init.maxToolRounds === "number" && init.maxToolRounds > 0
      ? Math.min(init.maxToolRounds, MAX_TOOL_ROUNDS)
      : MAX_TOOL_ROUNDS;

  let history: LlmMessage[] = [...init.messages];
  let capHit = false;

  for (let round = 0; round < maxRounds; round++) {
    if (ws.readyState !== ws.OPEN) break;

    const result = await callLlm({
      model: init.model,
      max_tokens: init.max_tokens,
      system: init.system,
      messages: history,
      tools: init.tools,
      key,
    });

    if (!result.ok) {
      broadcastAiStatus(docs, init.roomName, "idle");
      wsSend(ws, { type: "error", message: result.message });
      ws.close();
      return;
    }

    const { data } = result;
    history = [...history, { role: "assistant", content: data.content }];

    // Stream text blocks to the client as they arrive
    for (const block of data.content) {
      if (block.type === "text" && block.text.trim()) {
        wsSend(ws, { type: "text", text: block.text });
      }
    }

    if (data.stop_reason !== "tool_use") break;

    // Route every tool_use block back to the originating client and
    // await the result before continuing the LLM loop.
    const toolResultBlocks: LlmContentBlock[] = [];

    for (const block of data.content) {
      if (block.type !== "tool_use") continue;

      wsSend(ws, {
        type: "tool_call",
        id: block.id,
        toolName: block.name,
        args: block.input ?? {},
      });

      const [toolResult, toolError] = await new Promise<
        [unknown, string | undefined]
      >((resolve) => {
        pendingToolResults.set(block.id, (r, e) => resolve([r, e]));
      });

      toolResultBlocks.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: toolError
          ? JSON.stringify({
              ok: false,
              code: "TOOL_ERROR",
              message: toolError,
            })
          : JSON.stringify(toolResult),
      });
    }

    history = [...history, { role: "user", content: toolResultBlocks }];

    if (round === maxRounds - 1) {
      capHit = true;
    }
  }

  broadcastAiStatus(docs, init.roomName, "idle");
  // Send the complete updated history so the client can update its
  // conversation state for subsequent turns.
  wsSend(ws, { type: "done", history, ...(capHit ? { capHit: true } : {}) });
  ws.close();
}

// ── Attach ────────────────────────────────────────────────────────────────

/**
 * Attach the AI WebSocket handler to an existing Node http.Server.
 * Must be called after the HTTP server has started listening.
 * Returns a cleanup function.
 *
 * Pass the Hocuspocus `server.documents` map to enable AI presence
 * broadcasting: when a chat session starts the server emits a stateless
 * `{ type:'ai-status', status:'thinking' }` to all clients in the room,
 * and `status:'idle'` when the loop finishes or errors.
 */
export function attachAiWs(
  httpServer: Server,
  pathPrefix = "/api/ai",
  hocuspocusDocs: HocuspocusDocuments | null = null,
): () => void {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (
    req: IncomingMessage,
    socket: import("node:net").Socket,
    head: Buffer,
  ) => {
    if (!(req.url ?? "/").startsWith(pathPrefix)) return;
    wss.handleUpgrade(req, socket, head, (ws) =>
      handleAiConnection(ws, hocuspocusDocs),
    );
  };

  httpServer.on("upgrade", onUpgrade);

  return () => {
    httpServer.off("upgrade", onUpgrade);
    wss.close();
  };
}
