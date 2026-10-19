import type {
  Evaluator,
  FlowContext,
  RedactionConfig,
  ResourceCapability,
} from "@ai-testing-env/core";

export type AiRole = "system" | "user" | "assistant" | "tool";

export interface AiMessage {
  role: AiRole;
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface AiToolDefinition {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface AiRequest {
  model: string;
  prompt?: string;
  messages?: readonly AiMessage[];
  tools?: readonly AiToolDefinition[];
  responseSchema?: unknown;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface AiToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface AiUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface AiResponse<T = unknown> {
  output: T;
  text?: string;
  toolCalls?: readonly AiToolCall[];
  usage?: AiUsage;
  latencyMs?: number;
  providerResponseId?: string;
}

export type AiAdapterMode = "mocked" | "record" | "replay" | "live";

export interface AiAdapter {
  readonly provider: string;
  readonly mode: AiAdapterMode;
  readonly capabilities: readonly ResourceCapability[];
  execute<T = unknown>(request: AiRequest): Promise<AiResponse<T>>;
}

export interface AiStepDefinition<T> {
  id: string;
  name?: string;
  request: AiRequest;
  evaluators?: readonly Evaluator<AiResponse<T>>[];
}

export interface AiFixture {
  schemaVersion: 1;
  key: string;
  provider: string;
  recordedAt: string;
  request: AiRequest;
  response: AiResponse;
}

export interface AiFixtureRepository {
  get(key: string): Promise<AiFixture | undefined>;
  save(fixture: AiFixture): Promise<void>;
}

export interface FixtureKeyOptions {
  redaction?: RedactionConfig;
}

export type MockAiResponder = (
  request: AiRequest,
) => AiResponse | Promise<AiResponse>;

export type AiFlowContext = Pick<FlowContext, "step">;
