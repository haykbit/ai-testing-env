import type { RedactionConfig, RunTrace } from "./types.js";

export const defaultSensitiveKeys: readonly string[] = [
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "apikey",
  "api_key",
  "token",
  "access-token",
  "access_token",
  "refresh-token",
  "refresh_token",
  "password",
  "secret",
  "client-secret",
  "client_secret",
];

const defaultReplacement = "[REDACTED]";

export function redactRunTrace(
  run: RunTrace,
  config: RedactionConfig = {},
): RunTrace {
  return redactValue(run, config);
}

export function redactValue<T>(
  value: T,
  config: RedactionConfig = {},
): T {
  const sensitiveKeys = new Set(
    [...defaultSensitiveKeys, ...(config.sensitiveKeys ?? [])].map(normalizeKey),
  );
  const sensitiveValues = (config.sensitiveValues ?? []).filter(
    (entry) => entry.length > 0,
  );
  const replacement = config.replacement ?? defaultReplacement;
  const seen = new WeakMap<object, unknown>();

  function visit(current: unknown): unknown {
    if (typeof current === "string") {
      return redactString(
        current,
        sensitiveKeys,
        sensitiveValues,
        replacement,
      );
    }
    if (
      current === null
      || current === undefined
      || typeof current !== "object"
    ) {
      return current;
    }
    if (current instanceof Date) {
      return new Date(current.getTime());
    }

    const existing = seen.get(current);
    if (existing !== undefined) {
      return existing;
    }
    if (Array.isArray(current)) {
      const result: unknown[] = [];
      seen.set(current, result);
      for (const entry of current) {
        result.push(visit(entry));
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    seen.set(current, result);
    for (const [key, entry] of Object.entries(current)) {
      result[key] = sensitiveKeys.has(normalizeKey(key))
        ? replacement
        : visit(entry);
    }
    return result;
  }

  return visit(value) as T;
}

function redactString(
  value: string,
  sensitiveKeys: ReadonlySet<string>,
  sensitiveValues: readonly string[],
  replacement: string,
): string {
  let redacted = value;
  for (const sensitiveValue of sensitiveValues) {
    redacted = redacted.replaceAll(sensitiveValue, replacement);
  }

  let url: URL;
  try {
    url = new URL(redacted);
  } catch {
    return redacted;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return redacted;
  }

  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (sensitiveKeys.has(normalizeKey(key))) {
      url.searchParams.set(key, replacement);
      changed = true;
    }
  }
  if (url.username.length > 0) {
    url.username = replacement;
    changed = true;
  }
  if (url.password.length > 0) {
    url.password = replacement;
    changed = true;
  }
  return changed ? url.toString() : redacted;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}
