import { afterEach, describe, expect, it, vi } from "vitest";

import { streamSse, type SseEvent } from "@/lib/sse-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

function chunkedResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "text/event-stream" } },
  );
}

describe("streamSse", () => {
  it("parses partial frames, multi-line data, ids, default events, and a final unseparated frame", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        chunkedResponse([
          "id: event-7\nevent: update\ndata: first",
          " line\ndata: second\n\n",
          "data: default event\n\n",
          "event: done\ndata: final payload",
        ]),
      ),
    );
    const events: SseEvent[] = [];

    await streamSse({
      path: "/v1/agent/run_sse",
      body: { message: "hello" },
      onEvent: (event) => events.push(event),
    });

    expect(events).toEqual([
      { id: "event-7", event: "update", data: "first line\nsecond" },
      { event: "message", data: "default event" },
      { event: "done", data: "final payload" },
    ]);
  });

  it("posts JSON with bearer auth and the caller AbortSignal", async () => {
    const fetchMock = vi.fn().mockResolvedValue(chunkedResponse([]));
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await streamSse({
      path: "/v1/graph/run_sse",
      body: { topic: "SSE" },
      token: "stream-token",
      signal: controller.signal,
      onEvent: vi.fn(),
    });

    expect(fetchMock).toHaveBeenCalledWith("/v1/graph/run_sse", {
      method: "POST",
      headers: {
        Authorization: "Bearer stream-token",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ topic: "SSE" }),
      signal: controller.signal,
    });
  });

  it("rejects unsuccessful responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, { status: 500, statusText: "Internal Server Error" }),
      ),
    );

    await expect(
      streamSse({ path: "/v1/stream", body: {}, onEvent: vi.fn() }),
    ).rejects.toMatchObject({ status: 500, message: "Internal Server Error" });
  });

  it("rejects a successful response without a readable body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        body: null,
      } as Response),
    );

    await expect(
      streamSse({ path: "/v1/stream", body: {}, onEvent: vi.fn() }),
    ).rejects.toThrow("SSE response body is unavailable");
  });

  it("passes AbortError through unchanged", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    const fetchMock = vi.fn().mockRejectedValue(abortError);
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    const pending = streamSse({
      path: "/v1/stream",
      body: {},
      signal: controller.signal,
      onEvent: vi.fn(),
    });

    await expect(pending).rejects.toBe(abortError);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
  });

  it("cancels and releases the reader when an event handler fails, preserving the original error", async () => {
    const originalError = new Error("event handler failed");
    const releaseLock = vi.fn();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const read = vi
      .fn()
      .mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode("data: payload\\n\\n"),
      })
      .mockResolvedValueOnce({ done: true, value: undefined });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        body: { getReader: () => ({ read, cancel, releaseLock }) },
      } as unknown as Response),
    );

    await expect(
      streamSse({
        path: "/v1/stream",
        body: {},
        onEvent: () => {
          throw originalError;
        },
      }),
    ).rejects.toBe(originalError);
    expect(cancel).toHaveBeenCalledOnce();
    expect(releaseLock).toHaveBeenCalledOnce();
  });
});
