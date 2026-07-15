import { ApiError } from "@/lib/api-client";

export interface SseEvent {
  event: string;
  data: string;
  id?: string;
}

export interface StreamSseOptions {
  path: string;
  body: unknown;
  token?: string;
  signal?: AbortSignal;
  onEvent: (event: SseEvent) => void;
}

function dispatchFrame(frame: string, onEvent: (event: SseEvent) => void): void {
  let event = "message";
  let id: string | undefined;
  const data: string[] = [];

  for (const line of frame.split(/\r\n|\n|\r/)) {
    if (!line || line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);

    if (field === "event") event = value || "message";
    else if (field === "id") id = value;
    else if (field === "data") data.push(value);
  }

  if (data.length === 0) return;
  onEvent({ ...(id === undefined ? {} : { id }), event, data: data.join("\n") });
}

function frameBoundary(buffer: string): { index: number; length: number } | null {
  const match = /\r\n\r\n|\n\n|\r\r/.exec(buffer);
  return match ? { index: match.index, length: match[0].length } : null;
}

export async function streamSse(options: StreamSseOptions): Promise<void> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options.token) headers.Authorization = `Bearer ${options.token}`;

  const response = await fetch(options.path, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body),
    signal: options.signal,
  });

  if (!response.ok) {
    throw new ApiError(
      response.status,
      response.statusText || `SSE request failed with status ${response.status}`,
    );
  }
  if (!response.body) throw new Error("SSE response body is unavailable");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let boundary = frameBoundary(buffer);
      while (boundary) {
        dispatchFrame(buffer.slice(0, boundary.index), options.onEvent);
        buffer = buffer.slice(boundary.index + boundary.length);
        boundary = frameBoundary(buffer);
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) dispatchFrame(buffer, options.onEvent);
  } catch (error) {
    try {
      await reader.cancel();
    } catch {
      // Preserve the original read or event-handler error.
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}
