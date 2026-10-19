import { redactValue, type RedactionConfig } from "@ai-testing-env/core";
import { httpFixtureKey } from "./fixture-key.js";
import type {
  HttpAdapter,
  HttpFixtureRepository,
  HttpRequest,
  HttpResponse,
  MockHttpResponder,
} from "./types.js";

export class MockHttpAdapter implements HttpAdapter {
  readonly mode = "mocked" as const;
  readonly capabilities = [];

  constructor(private readonly responder: MockHttpResponder) {}

  async execute<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
    return await this.responder(request) as HttpResponse<T>;
  }
}

export interface RecordingHttpAdapterOptions {
  delegate: HttpAdapter;
  fixtures: HttpFixtureRepository;
  redaction?: RedactionConfig;
  now?: () => Date;
}

export class RecordingHttpAdapter implements HttpAdapter {
  readonly mode = "record" as const;
  readonly capabilities;
  private readonly now: () => Date;

  constructor(private readonly options: RecordingHttpAdapterOptions) {
    this.capabilities = options.delegate.capabilities;
    this.now = options.now ?? (() => new Date());
  }

  async execute<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
    const response = await this.options.delegate.execute<T>(request);
    const key = httpFixtureKey(request, this.options.redaction === undefined
      ? {}
      : { redaction: this.options.redaction });
    await this.options.fixtures.save({
      schemaVersion: 1,
      key,
      recordedAt: this.now().toISOString(),
      request: redactValue(request, this.options.redaction),
      response: redactValue(response, this.options.redaction),
    });
    return response;
  }
}

export interface ReplayHttpAdapterOptions {
  fixtures: HttpFixtureRepository;
  redaction?: RedactionConfig;
}

export class ReplayHttpAdapter implements HttpAdapter {
  readonly mode = "replay" as const;
  readonly capabilities = [];

  constructor(private readonly options: ReplayHttpAdapterOptions) {}

  async execute<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
    const key = httpFixtureKey(request, this.options.redaction === undefined
      ? {}
      : { redaction: this.options.redaction });
    const fixture = await this.options.fixtures.get(key);
    if (fixture === undefined) throw new HttpFixtureNotFoundError(key);
    if (fixture.key !== key) {
      throw new HttpFixtureCorruptError(key, "fixture key does not match request");
    }
    return fixture.response as HttpResponse<T>;
  }
}

export interface FetchHttpAdapterOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => number;
  timeoutMs?: number;
  responseHeaderAllowlist?: readonly string[];
}

export class FetchHttpAdapter implements HttpAdapter {
  readonly mode = "integration" as const;
  readonly capabilities = ["network"] as const;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly responseHeaderAllowlist: readonly string[];

  constructor(options: FetchHttpAdapterOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => Date.now());
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.responseHeaderAllowlist = options.responseHeaderAllowlist
      ?? defaultHeaderAllowlist;
  }

  async execute<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>> {
    const startedAt = this.now();
    const response = await this.fetch(request.url, {
      method: request.method,
      ...(request.headers === undefined ? {} : { headers: request.headers }),
      ...(request.body === undefined
        ? {}
        : { body: serializeBody(request.body, request.headers) }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const body = await parseBody(response);
    return {
      status: response.status,
      headers: selectHeaders(response.headers, this.responseHeaderAllowlist),
      body: body as T,
      durationMs: this.now() - startedAt,
    };
  }
}

export class HttpFixtureNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No recorded HTTP fixture for key ${key}`);
    this.name = "HttpFixtureNotFoundError";
  }
}

export class HttpFixtureCorruptError extends Error {
  constructor(readonly key: string, reason: string) {
    super(`Invalid HTTP fixture ${key}: ${reason}`);
    this.name = "HttpFixtureCorruptError";
  }
}

export const defaultHeaderAllowlist: readonly string[] = [
  "accept",
  "content-type",
  "location",
  "traceparent",
  "user-agent",
  "x-request-id",
];

export function selectHeaders(
  headers: Headers | Readonly<Record<string, string>> | undefined,
  allowlist: readonly string[] = defaultHeaderAllowlist,
): Record<string, string> {
  if (headers === undefined) return {};
  const allowed = new Set(allowlist.map((name) => name.toLowerCase()));
  const entries = headers instanceof Headers
    ? [...headers.entries()]
    : Object.entries(headers);
  return Object.fromEntries(
    entries.filter(([name]) => allowed.has(name.toLowerCase())),
  );
}

function serializeBody(
  body: unknown,
  headers: Readonly<Record<string, string>> | undefined,
): BodyInit {
  if (typeof body === "string") return body;
  const contentType = Object.entries(headers ?? {}).find(
    ([name]) => name.toLowerCase() === "content-type",
  )?.[1];
  if (contentType?.includes("application/json") !== false) {
    return JSON.stringify(body);
  }
  return String(body);
}

async function parseBody(response: Response): Promise<unknown> {
  if (response.status === 204 || response.status === 205) return undefined;
  const text = await response.text();
  if (text.length === 0) return undefined;
  if (response.headers.get("content-type")?.includes("application/json") === true) {
    try {
      return JSON.parse(text);
    } catch {
      throw new HttpResponseParseError(response.status);
    }
  }
  return text;
}

export class HttpResponseParseError extends Error {
  constructor(readonly status: number) {
    super(`HTTP ${status} response declared JSON but contained invalid JSON`);
    this.name = "HttpResponseParseError";
  }
}
