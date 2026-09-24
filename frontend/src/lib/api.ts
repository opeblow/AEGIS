import type { ApiErrorBody } from "./types";

export const API_BASE =
  (process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:4000").replace(
    /\/+$/,
    "",
  ) + "/api/v1";

export const SESSION_COOKIE = "aegis_session";
export const CSRF_COOKIE = "aegis_csrf";

export class ApiError extends Error {
  code: string;
  status: number;
  details?: unknown;
  requestId?: string;

  constructor(
    status: number,
    body: ApiErrorBody["error"] & { requestId?: string },
  ) {
    super(body.message || `Request failed (${status})`);
    this.name = "ApiError";
    this.code = body.code || "UNKNOWN";
    this.status = status;
    this.details = body.details;
    this.requestId = body.requestId;
  }
}

/** True when the process is running in a browser (avoids cookie reads on the server). */
export const isBrowser = () => typeof window !== "undefined";

export function readCsrfToken(): string | null {
  if (!isBrowser()) return null;
  const m = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return m ? decodeURIComponent(m.slice(CSRF_COOKIE.length + 1)) : null;
}

export function readSessionCookie(): string | null {
  if (!isBrowser()) return null;
  const m = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`));
  return m ? m.slice(SESSION_COOKIE.length + 1) : null;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const contentType = res.headers.get("content-type") ?? "";
  const body = contentType.includes("application/json")
    ? ((await res.json()) as T | ApiErrorBody)
    : null;

  if (!res.ok) {
    const err = (body as ApiErrorBody | null)?.error;
    throw new ApiError(res.status, {
      code: err?.code ?? String(res.status),
      message: err?.message ?? (res.statusText || `Request failed`),
      details: err?.details,
      requestId: err?.requestId,
    });
  }
  return body as T;
}

interface RequestOptions extends RequestInit {
  /** Non-GET requests send the CSRF header (read from cookie). */
  csrf?: boolean;
}

export async function api<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const { csrf = options.method && options.method !== "GET", ...init } =
    options;

  const headers = new Headers(init.headers);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (csrf) {
    const token = readCsrfToken();
    if (token) headers.set("x-csrf-token", token);
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers,
    credentials: "include",
  });
  return handleResponse<T>(res);
}

export const get = <T>(path: string, init?: RequestInit) =>
  api<T>(path, { ...init, method: "GET" });

export const post = <T>(path: string, body?: unknown, init?: RequestInit) =>
  api<T>(path, { ...init, method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });

export const patch = <T>(path: string, body?: unknown, init?: RequestInit) =>
  api<T>(path, { ...init, method: "PATCH", body: body === undefined ? undefined : JSON.stringify(body) });

export const del = <T>(path: string, init?: RequestInit) =>
  api<T>(path, { ...init, method: "DELETE" });

export const qs = (
  params: Record<string, string | number | boolean | undefined | null>,
): string => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
};

export function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "An unexpected error occurred.";
}