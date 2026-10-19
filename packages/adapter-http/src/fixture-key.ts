import { createHash } from "node:crypto";
import { redactValue } from "@ai-testing-env/core";
import type { HttpFixtureKeyOptions, HttpRequest } from "./types.js";

export function httpFixtureKey(
  request: HttpRequest,
  options: HttpFixtureKeyOptions = {},
): string {
  const canonical = canonicalize(redactValue(request, options.redaction));
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}
