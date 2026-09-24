/**
 * Canonical serialization used to hash structured payloads deterministically.
 * Sorted object keys make the output independent of insertion order; arrays
 * keep their order (a reordered array is materially different input).
 *
 * Shared by the AI/ML (Phase 9) and quantum optimization (Phase 10) modules so
 * idempotency keys computed from canonical payloads are consistent.
 */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const body = keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`,
      )
      .join(",");
    return `{${body}}`;
  }
  return JSON.stringify(value);
}