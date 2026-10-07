/**
 * A minimal MCP Streamable HTTP client, enough to check a T3 credential and
 * exercise the same `/mcp` endpoint tunnel-client forwards to. It speaks the
 * 2025-06-18 lifecycle T3 declares: initialize, initialized, then requests,
 * carrying `Mcp-Session-Id` when the server issues one.
 */

export const T3_PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(message, { status, rpcError } = {}) {
    super(message);
    this.status = status;
    this.rpcError = rpcError;
  }
}

/** Extracts the JSON-RPC message answering `id` from a JSON or SSE body. */
export function parseRpcBody(contentType, text, id) {
  if (contentType?.includes("text/event-stream")) {
    for (const event of text.split(/\r?\n\r?\n/)) {
      const data = event
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!data) continue;
      const message = JSON.parse(data);
      const messages = Array.isArray(message) ? message : [message];
      const match = messages.find((candidate) => candidate.id === id);
      if (match) return match;
    }
    return undefined;
  }
  if (!text) return undefined;
  const message = JSON.parse(text);
  const messages = Array.isArray(message) ? message : [message];
  return messages.find((candidate) => candidate.id === id);
}

export class McpHttpClient {
  #nextId = 1;

  constructor({ url, headers = {}, protocolVersion = T3_PROTOCOL_VERSION, timeoutMs = 60_000 }) {
    this.url = url;
    this.headers = headers;
    this.requestedProtocolVersion = protocolVersion;
    this.timeoutMs = timeoutMs;
    this.sessionId = undefined;
    this.protocolVersion = undefined;
    this.serverInfo = undefined;
  }

  #headers() {
    return {
      ...this.headers,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      ...(this.protocolVersion ? { "mcp-protocol-version": this.protocolVersion } : {}),
    };
  }

  async #post(message, timeoutMs = this.timeoutMs) {
    const response = await fetch(this.url, {
      method: "POST",
      headers: this.#headers(),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;
    const text = await response.text();
    return { response, text };
  }

  async request(method, params, { timeoutMs } = {}) {
    const id = this.#nextId++;
    const { response, text } = await this.#post({ jsonrpc: "2.0", id, method, params }, timeoutMs);
    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        const body = JSON.parse(text);
        detail = body.message ?? body.error?.message ?? detail;
      } catch {}
      throw new McpError(`${method}: HTTP ${response.status} ${detail}`, { status: response.status });
    }
    const message = parseRpcBody(response.headers.get("content-type"), text, id);
    if (!message) throw new McpError(`${method}: no JSON-RPC response for request ${id}`);
    if (message.error) {
      throw new McpError(`${method}: ${message.error.message}`, { rpcError: message.error });
    }
    return message.result;
  }

  async notify(method, params) {
    const { response, text } = await this.#post({ jsonrpc: "2.0", method, ...(params ? { params } : {}) });
    if (!response.ok) {
      throw new McpError(`${method}: HTTP ${response.status} ${text.slice(0, 200)}`, {
        status: response.status,
      });
    }
  }

  async initialize(clientInfo = { name: "t3mcp-check", version: "0.1.0" }) {
    const result = await this.request("initialize", {
      protocolVersion: this.requestedProtocolVersion,
      capabilities: {},
      clientInfo,
    });
    this.protocolVersion = result.protocolVersion;
    this.serverInfo = result.serverInfo;
    await this.notify("notifications/initialized");
    return result;
  }

  async listTools() {
    const tools = [];
    let cursor;
    do {
      const page = await this.request("tools/list", cursor ? { cursor } : {});
      tools.push(...(page.tools ?? []));
      cursor = page.nextCursor;
    } while (cursor);
    return tools;
  }

  async callTool(name, args = {}, options) {
    return this.request("tools/call", { name, arguments: args }, options);
  }

  /** Ends the server-side session, if one was issued. Failures are ignored. */
  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, {
        method: "DELETE",
        headers: this.#headers(),
        signal: AbortSignal.timeout(5_000),
      });
    } catch {}
    this.sessionId = undefined;
  }
}

/** The structured result of a tool call, falling back to its JSON text content. */
export function toolPayload(result) {
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const text = result?.content?.find((item) => item.type === "text")?.text;
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
