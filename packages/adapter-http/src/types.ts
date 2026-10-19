import type {
  Evaluator,
  FlowContext,
  RedactionConfig,
  ResourceCapability,
} from "@ai-testing-env/core";

export type HttpMethod = "DELETE" | "GET" | "HEAD" | "OPTIONS" | "PATCH" | "POST" | "PUT";

export interface HttpRequest {
  method: HttpMethod;
  url: string;
  headers?: Readonly<Record<string, string>>;
  body?: unknown;
}

export interface HttpResponse<T = unknown> {
  status: number;
  headers: Readonly<Record<string, string>>;
  body: T;
  durationMs: number;
}

export type HttpAdapterMode = "mocked" | "record" | "replay" | "integration";

export interface HttpAdapter {
  readonly mode: HttpAdapterMode;
  readonly capabilities: readonly ResourceCapability[];
  execute<T = unknown>(request: HttpRequest): Promise<HttpResponse<T>>;
}

export interface HttpStepDefinition<T> {
  id: string;
  name?: string;
  request: HttpRequest;
  evaluators?: readonly Evaluator<HttpResponse<T>>[];
  headerAllowlist?: readonly string[];
}

export interface HttpFixture {
  schemaVersion: 1;
  key: string;
  recordedAt: string;
  request: HttpRequest;
  response: HttpResponse;
}

export interface HttpFixtureRepository {
  get(key: string): Promise<HttpFixture | undefined>;
  save(fixture: HttpFixture): Promise<void>;
}

export interface HttpFixtureKeyOptions {
  redaction?: RedactionConfig;
}

export type MockHttpResponder = (
  request: HttpRequest,
) => HttpResponse | Promise<HttpResponse>;

export type HttpFlowContext = Pick<FlowContext, "step">;
