import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, apiRequest } from "@/lib/api-client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiRequest", () => {
  it("uses the same-origin path and combines caller headers with JSON auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      apiRequest<{ ok: boolean }>("/v1/items", {
        method: "POST",
        body: JSON.stringify({ name: "test" }),
        headers: { "X-Request-ID": "request-1" },
        token: "secret-token",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe("/v1/items");
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer secret-token");
    expect(headers.get("X-Request-ID")).toBe("request-1");
  });

  it("does not add a JSON content type for FormData", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ uploaded: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const body = new FormData();
    body.append("file", new Blob(["hello"]), "hello.txt");

    await apiRequest("/v1/files", { method: "POST", body });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.has("Content-Type")).toBe(false);
  });

  it("throws ApiError with a FastAPI detail message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ detail: "Document not found" }), {
          status: 404,
          statusText: "Not Found",
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const pending = apiRequest("/v1/documents/missing");

    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({
      status: 404,
      message: "Document not found",
    });
  });

  it("falls back to status text when an error has no detail", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("gateway unavailable", {
          status: 503,
          statusText: "Service Unavailable",
        }),
      ),
    );

    await expect(apiRequest("/v1/health")).rejects.toMatchObject({
      status: 503,
      message: "Service Unavailable",
    });
  });

  it("returns undefined for a successful 204 response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 204 })),
    );

    await expect(apiRequest<void>("/v1/items/1", { method: "DELETE" })).resolves.toBeUndefined();
  });
});
