export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionOptions {
  endpoint: string;
  deployment: string;
  accessToken: string;
  messages: ChatMessage[];
  onChunk?: (chunk: string) => void | Promise<void>;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCompletion(data: string): unknown[] {
  const payload: unknown = JSON.parse(data);
  if (!isObject(payload)) {
    throw new Error("Invalid Azure OpenAI response.");
  }
  if (payload.error) {
    throw new Error(`Azure OpenAI error: ${JSON.stringify(payload.error)}`);
  }
  if (!Array.isArray(payload.choices)) {
    throw new Error("Azure OpenAI response is missing choices.");
  }
  return payload.choices;
}

function readContent(choice: unknown, field: "delta" | "message"): string {
  if (!isObject(choice) || !isObject(choice[field])) {
    throw new Error(`Invalid Azure OpenAI ${field}.`);
  }
  const content = choice[field].content;
  if (content === undefined || content === null) {
    return "";
  }
  if (typeof content !== "string") {
    throw new Error("Invalid Azure OpenAI response content.");
  }
  return content;
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

export async function sendChatCompletion(options: ChatCompletionOptions): Promise<string> {
  if (!options.endpoint || !options.deployment) {
    throw new Error("AZURE_OPENAI_ENDPOINT and AZURE_OPENAI_DEPLOYMENT_NAME are required.");
  }
  const url = new URL(
    `${options.endpoint.replace(/\/$/, "")}/openai/deployments/${encodeURIComponent(options.deployment)}/chat/completions`
  );
  url.searchParams.set("api-version", "2024-10-21");

  const response = await fetch(url, {
    dispatcher,
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      "Content-Type": "application/json",
      Accept: options.onChunk ? "text/event-stream" : "application/json",
    },
    body: JSON.stringify({
      messages: options.messages,
      stream: !!options.onChunk,
    }),
    signal: AbortSignal.timeout(600_000),
  });

  if (!response.ok) {
    throw new Error(`Azure OpenAI HTTP ${response.status}: ${await response.text()}`);
  }
  if (!options.onChunk) {
    const choices = parseCompletion(await response.text());
    return readContent(choices[0], "message");
  }
  if (!response.headers.get("content-type")?.toLowerCase().startsWith("text/event-stream")) {
    throw new Error("Expected an Azure OpenAI SSE response.");
  }
  if (!response.body) {
    throw new Error("Azure OpenAI response has no streaming body.");
  }

  let content = "";
  for await (const event of readEvents(response.body)) {
    if (event === "[DONE]") {
      return content;
    }
    const choices = parseCompletion(event);
    if (choices.length === 0) {
      continue;
    }
    const chunk = readContent(choices[0], "delta");
    if (chunk) {
      content += chunk;
      await options.onChunk(chunk);
    }
  }
  throw new Error("Azure OpenAI stream ended before [DONE].");
}
import { ReadableStream } from "node:stream/web";
import { Agent, fetch } from "undici";

// Node's default TLS handshake is reset on this network; keep certificate verification enabled.
const dispatcher = new Agent({ connect: { maxVersion: "TLSv1.2" } });

