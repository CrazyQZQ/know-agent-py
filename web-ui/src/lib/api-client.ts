export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export type ApiRequestOptions = RequestInit & { token?: string };

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) unauthorizedHandler = null;
  };
}

export async function apiRequest<T>(
  path: string,
  options: ApiRequestOptions = {},
): Promise<T> {
  const { token, ...requestInit } = options;
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;

  if (!isFormData && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(path, { ...requestInit, headers });

  if (response.status === 401) unauthorizedHandler?.();

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const payload: unknown = await response.json();
      if (
        typeof payload === "object"
        && payload !== null
        && "detail" in payload
        && typeof payload.detail === "string"
      ) {
        detail = payload.detail;
      }
    } catch {
      // Non-JSON error bodies use the HTTP status text below.
    }
    throw new ApiError(
      response.status,
      detail || response.statusText || `Request failed with status ${response.status}`,
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
