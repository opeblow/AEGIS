"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { get, qs, type ApiError } from "./api";

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
  setData: (d: T | null) => void;
}

/** Loads data from `path` with automatic refetch on path change. */
export function useApi<T>(
  path: string | null,
  opts: { refresh?: number } = {},
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(!!path);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    if (!path) return;
    const id = ++seq.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    get<T>(path)
      .then((d) => {
        if (seq.current !== id) return;
        setData(d);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (seq.current !== id) return;
        setError(e instanceof Error ? e.message : "Request failed");
        setLoading(false);
      });
  }, [path, nonce, opts.refresh]);

  return { data, loading, error, reload, setData };
}

export interface PageState<T> extends AsyncState<T> {
  page: number;
  setPage: (p: number) => void;
  total: number;
}

export function usePageApi<T extends { total: number }>(
  basePath: string | null,
  params: Record<string, string | number | boolean | undefined | null>,
  chunks: { enabled?: boolean } = {},
): PageState<T> {
  const [page, setPage] = useState(1);
  const path = basePath
    ? `${basePath}${qs({ ...params, page })}`
    : null;
  const state = useApi<T>(chunks.enabled === false ? null : path, { refresh: page });
  return {
    ...state,
    page,
    setPage: (p) => {
      setPage(p);
      state.reload();
    },
    total: state.data?.total ?? 0,
  };
}

/** Immediate execution hook for form actions. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<R | null>(null);

  const run = useCallback(
    async (...a: A) => {
      setBusy(true);
      setError(null);
      try {
        const r = await fn(...a);
        setResult(r);
        return r;
      } catch (e) {
        const msg =
          e instanceof Error
            ? e.message
            : "Request failed.";
        setError(msg);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [fn],
  );

  return { run, busy, error, result, setError };
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && "code" in e && typeof (e as ApiError).code === "string";
}

export { qs };