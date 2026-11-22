import { ReadableStream } from "node:stream/web";
import { Agent, fetch } from "undici";

// Node's default TLS handshake is reset on this network; keep certificate verification enabled.
const dispatcher = new Agent({ connect: { maxVersion: "TLSv1.2" } });

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface ResponsesOptions {
  endpoint: string;
  apiVersion: string;
  accessToken: string;
  messages: ChatMessage[];
  onChunk?: (chunk: string) => void | Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePayload(data: string): Record<string, unknown> {
  const payload: unknown = JSON.parse(data);
  if (!isObject(payload)) {
    throw new Error("Invalid Foundry response.");
  }
  if (payload.error) {
    throw new Error(`Foundry error: ${JSON.stringify(payload.error)}`);
  }
  return payload;
}

// Concatenates the text of every output_text part of every message item.
function readOutputText(response: Record<string, unknown>): string {
  if (!Array.isArray(response.output)) {
    throw new Error("Foundry response is missing output.");
  }
  let text = "";
  for (const item of response.output) {
    if (!isObject(item) || item.type !== "message" || !Array.isArray(item.content)) {
      continue;
    }
    for (const part of item.content) {
      if (isObject(part) && part.type === "output_text" && typeof part.text === "string") {
        text += part.text;
      }
    }
  }
  return text;
}

async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];

  try {
    let finished = false;
    while (!finished) {
      const result = await reader.read();
      finished = result.done;
      buffer += finished ? decoder.decode() : decoder.decode(result.value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r\n|\r|\n/.exec(buffer)) !== null) {
        // A CR at the end of a network chunk may be the first half of CRLF.
        if (!finished && match[0] === "\r" && match.index === buffer.length - 1) {
          break;
        }
        const line = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        if (line === "") {
          if (data.length > 0) {
            const event = data.join("\n");
            data = [];
            yield event;
          }
        } else if (line.startsWith("data:")) {
          const value = line.slice(5);
          data.push(value.startsWith(" ") ? value.slice(1) : value);
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}

export async function sendResponse(options: ResponsesOptions): Promise<string> {
  if (!options.endpoint || !options.apiVersion) {
    throw new Error("FOUNDRY_AGENT_ENDPOINT and FOUNDRY_API_VERSION are required.");
  }
  const url = new URL(options.endpoint);
  url.searchParams.set("api-version", options.apiVersion);

  const response = await fetch(url, {
    dispatcher,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
      Accept: options.onChunk ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify({
      input: options.messages,
      stream: !!options.onChunk,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!response.ok) {
    throw new Error(`Foundry HTTP ${response.status}: ${await response.text()}`);
  }
  if (!options.onChunk) {
    return readOutputText(parsePayload(await response.text()));
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    throw new Error("Expected a Foundry SSE response.");
  }
  if (!response.body) {
    throw new Error("Foundry response has no streaming body.");
  }

  let content = "";
  for await (const event of readEvents(response.body)) {
    if (event === "[DONE]") {
      break;
    }
    const payload = parsePayload(event);
    switch (payload.type) {
      case "response.output_text.delta": {
        if (typeof payload.delta !== "string") {
          throw new Error("Invalid Foundry response content.");
        }
        if (payload.delta) {
          content += payload.delta;
          await options.onChunk(payload.delta);
        }
        break;
      }
      case "response.completed":
        return content;
      case "response.failed":
      case "response.incomplete":
        throw new Error(`Foundry ${payload.type}: ${JSON.stringify(payload.response)}`);
    }
  }
  throw new Error("Foundry stream ended before response.completed.");
}
