import assert from "node:assert/strict";
import { createServer, RequestListener } from "node:http";
import { test } from "node:test";
import { ChatMessage, sendResponse } from "./foundry-responses";

const messages: ChatMessage[] = [
  { role: "user", content: "Earlier question" },
  { role: "assistant", content: "Earlier answer" },
  { role: "user", content: "Hello" },
];

async function withServer(
  handler: RequestListener,
  run: (endpoint: string) => Promise<void>
): Promise<void> {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}/agents/a/responses`);
  } finally {
    const closed = new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    server.closeAllConnections();
    await closed;
  }
}

const delta = (text: string) => `event: response.output_text.delta\ndata: ${JSON.stringify({ type: "response.output_text.delta", delta: text })}\n\n`;
const completed = 'event: response.completed\ndata: {"type":"response.completed","response":{}}\n\n';

test("POSTs input, api-version and bearer token for a group response", async () => {
  let receivedBody = "";
  let receivedUrl: string | undefined;
  let receivedMethod: string | undefined;
  let authorization: string | undefined;
  await withServer((request, response) => {
    receivedUrl = request.url;
    receivedMethod = request.method;
    authorization = request.headers.authorization;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => { receivedBody += chunk; });
    request.on("end", () => {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        output: [
          { type: "reasoning" },
          { type: "message", content: [{ type: "output_text", text: "Hello back" }] },
        ],
      }));
    });
  }, async (endpoint) => {
    const result = await sendResponse({ endpoint, apiVersion: "v1", accessToken: "local-test-token", messages });
    assert.equal(result, "Hello back");
    assert.equal(receivedMethod, "POST");
    assert.equal(receivedUrl, "/agents/a/responses?api-version=v1");
    assert.equal(authorization, "Bearer local-test-token");
    assert.deepEqual(JSON.parse(receivedBody), { input: messages, stream: false });
  });
});

test("delivers SSE text before the server produces the complete answer", async () => {
  let release: () => void;
  const firstChunkReceived = new Promise<void>((resolve) => { release = resolve; });
  let serverCompleted = false;
  let receivedBody = "";
  const chunks: string[] = [];
  await withServer(async (request, response) => {
    request.setEncoding("utf8");
    for await (const chunk of request) {
      receivedBody += chunk;
    }
    response.setHeader("Content-Type", "text/event-stream");
    response.write('event: response.created\ndata: {"type":"response.created"}\n\n');
    response.write(delta("Hello"));
    const fallback = setTimeout(release, 1_000);
    await firstChunkReceived;
    clearTimeout(fallback);
    serverCompleted = true;
    response.end(delta(" world") + completed);
  }, async (endpoint) => {
    const result = await sendResponse({
      endpoint,
      apiVersion: "v1",
      accessToken: "local-test-token",
      messages,
      onChunk: async (chunk) => {
        if (chunks.length === 0) {
          assert.equal(serverCompleted, false, "Streaming must not wait for the full answer");
          release();
        }
        chunks.push(chunk);
      },
    });
    assert.deepEqual(chunks, ["Hello", " world"]);
    assert.equal(result, "Hello world");
    assert.deepEqual(JSON.parse(receivedBody), { input: messages, stream: true });
  });
});

test("decodes fragmented UTF-8, CRLF and coalesced SSE events", async () => {
  const chunks: string[] = [];
  const text = "caf\u00e9";
  await withServer(async (_request, response) => {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    const bytes = Buffer.from(
      ': heartbeat\r\n' +
      `data: {"type":"response.output_text.delta",\r\ndata: "delta":"${text}"}\r\n\r\n` +
      delta("!") + completed
    );
    for (const byte of bytes) {
      if (response.destroyed) break;
      response.write(Buffer.from([byte]));
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    response.end();
  }, async (endpoint) => {
    assert.equal(await sendResponse({
      endpoint,
      apiVersion: "v1",
      accessToken: "local-test-token",
      messages,
      onChunk: (chunk) => { chunks.push(chunk); },
    }), `${text}!`);
    assert.deepEqual(chunks, [text, "!"]);
  });
});

test("surfaces HTTP errors, malformed responses and interrupted streams", async (t) => {
  const cases = [
    { name: "HTTP failure", status: 429, type: "application/json", body: '{"error":"rate limited"}', error: /HTTP 429.*rate limited/ },
    { name: "unexpected content type", status: 200, type: "application/json", body: "{}", error: /Expected.*SSE/ },
    { name: "SSE API error", status: 200, type: "text/event-stream", body: 'data: {"error":{"message":"failed"}}\n\n', error: /Foundry error.*failed/ },
    { name: "response.failed", status: 200, type: "text/event-stream", body: 'data: {"type":"response.failed","response":{"status":"failed"}}\n\n', error: /response\.failed/ },
    { name: "malformed JSON", status: 200, type: "text/event-stream", body: "data: not JSON\n\n", error: /JSON/ },
    { name: "invalid delta", status: 200, type: "text/event-stream", body: 'data: {"type":"response.output_text.delta","delta":123}\n\n', error: /Invalid.*content/ },
    { name: "missing completed", status: 200, type: "text/event-stream", body: delta("partial"), error: /ended before response\.completed/ },
  ];
  for (const entry of cases) {
    await t.test(entry.name, async () => {
      await withServer((_request, response) => {
        response.writeHead(entry.status, { "Content-Type": entry.type });
        response.end(entry.body);
      }, async (endpoint) => {
        await assert.rejects(sendResponse({
          endpoint,
          apiVersion: "v1",
          accessToken: "local-test-token",
          messages,
          onChunk: () => {},
        }), entry.error);
      });
    });
  }
});

test("propagates consumer errors instead of silently dropping streaming chunks", async () => {
  await withServer((_request, response) => {
    response.setHeader("Content-Type", "text/event-stream");
    response.end(delta("Hello") + completed);
  }, async (endpoint) => {
    await assert.rejects(sendResponse({
      endpoint,
      apiVersion: "v1",
      accessToken: "local-test-token",
      messages,
      onChunk: () => { throw new Error("Delivery failed"); },
    }), /Delivery failed/);
  });
});
