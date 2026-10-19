import type {
  AiAdapter,
  AiMessage,
  AiRequest,
  AiResponse,
  AiToolCall,
  AiUsage,
} from "./types.js";

export interface OpenAIResponsesTransportAuth {
  apiKey: string;
  organization?: string;
  project?: string;
  baseUrl: string;
  timeoutMs: number;
}

export interface OpenAIResponsesTransport {
  create(
    request: Readonly<Record<string, unknown>>,
    auth: OpenAIResponsesTransportAuth,
  ): Promise<unknown>;
}

export interface OpenAIResponsesAdapterOptions {
  apiKey?: string;
  organization?: string;
  project?: string;
  baseUrl?: string;
  timeoutMs?: number;
  transport?: OpenAIResponsesTransport;
  now?: () => number;
}

export class OpenAIResponsesAdapter implements AiAdapter {
  readonly provider = "openai";
  readonly mode = "live" as const;
  readonly capabilities = ["network", "spend"] as const;
  private readonly transport: OpenAIResponsesTransport;
  private readonly auth: OpenAIResponsesTransportAuth;
  private readonly now: () => number;

  constructor(options: OpenAIResponsesAdapterOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new OpenAIResponsesConfigurationError(
        "Missing OpenAI API key; pass apiKey or set OPENAI_API_KEY",
      );
    }
    this.transport = options.transport ?? new FetchOpenAIResponsesTransport();
    this.auth = {
      apiKey,
      baseUrl: (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/$/, ""),
      timeoutMs: options.timeoutMs ?? 60_000,
      ...(options.organization === undefined
        ? {}
        : { organization: options.organization }),
      ...(options.project === undefined ? {} : { project: options.project }),
    };
    this.now = options.now ?? (() => Date.now());
  }

  async execute<T = unknown>(request: AiRequest): Promise<AiResponse<T>> {
    const startedAt = this.now();
    const payload = await this.transport.create(toOpenAIRequest(request), this.auth);
    const latencyMs = this.now() - startedAt;
    return normalizeOpenAIResponse<T>(payload, request.responseSchema !== undefined, latencyMs);
  }
}

export interface FetchOpenAIResponsesTransportOptions {
  fetch?: typeof globalThis.fetch;
}

export class FetchOpenAIResponsesTransport implements OpenAIResponsesTransport {
  private readonly fetch: typeof globalThis.fetch;

  constructor(options: FetchOpenAIResponsesTransportOptions = {}) {
    this.fetch = options.fetch ?? globalThis.fetch;
  }

  async create(
    request: Readonly<Record<string, unknown>>,
    auth: OpenAIResponsesTransportAuth,
  ): Promise<unknown> {
    const response = await this.fetch(`${auth.baseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${auth.apiKey}`,
        ...(auth.organization === undefined
          ? {}
          : { "openai-organization": auth.organization }),
        ...(auth.project === undefined ? {} : { "openai-project": auth.project }),
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(auth.timeoutMs),
    });
    const payload = await parseJsonResponse(response);
    if (!response.ok) {
      throw new OpenAIResponsesApiError(
        response.status,
        providerErrorMessage(payload) ?? `OpenAI Responses API returned ${response.status}`,
        response.headers.get("x-request-id") ?? undefined,
      );
    }
    return payload;
  }
}

export class OpenAIResponsesConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIResponsesConfigurationError";
  }
}

export class OpenAIResponsesApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "OpenAIResponsesApiError";
  }
}

export class OpenAIResponsesPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenAIResponsesPayloadError";
  }
}

function toOpenAIRequest(request: AiRequest): Readonly<Record<string, unknown>> {
  if (request.prompt === undefined && request.messages === undefined) {
    throw new OpenAIResponsesConfigurationError(
      "An OpenAI request requires prompt or messages",
    );
  }
  return {
    model: request.model,
    input: request.messages === undefined
      ? request.prompt
      : request.messages.map(toOpenAIInputItem),
    store: false,
    ...(request.tools === undefined
      ? {}
      : {
          tools: request.tools.map((tool) => ({
            type: "function",
            name: tool.name,
            ...(tool.description === undefined
              ? {}
              : { description: tool.description }),
            parameters: tool.inputSchema ?? { type: "object", properties: {} },
            strict: true,
          })),
        }),
    ...(request.responseSchema === undefined
      ? {}
      : {
          text: {
            format: {
              type: "json_schema",
              name: "response",
              schema: request.responseSchema,
              strict: true,
            },
          },
        }),
  };
}

function toOpenAIInputItem(message: AiMessage): Readonly<Record<string, unknown>> {
  if (message.role === "tool") {
    if (message.toolCallId === undefined) {
      throw new OpenAIResponsesConfigurationError(
        "Tool messages require toolCallId",
      );
    }
    return {
      type: "function_call_output",
      call_id: message.toolCallId,
      output: message.content,
    };
  }
  return { role: message.role, content: message.content };
}

function normalizeOpenAIResponse<T>(
  payload: unknown,
  structured: boolean,
  latencyMs: number,
): AiResponse<T> {
  if (!isRecord(payload) || !Array.isArray(payload.output)) {
    throw new OpenAIResponsesPayloadError(
      "OpenAI response is missing an output array",
    );
  }
  const texts: string[] = [];
  const toolCalls: AiToolCall[] = [];
  for (const item of payload.output) {
    if (!isRecord(item)) continue;
    if (item.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        if (isRecord(content) && content.type === "output_text" && typeof content.text === "string") {
          texts.push(content.text);
        }
      }
    }
    if (item.type === "function_call" && typeof item.name === "string") {
      const id = typeof item.call_id === "string"
        ? item.call_id
        : typeof item.id === "string"
          ? item.id
          : undefined;
      if (id === undefined) {
        throw new OpenAIResponsesPayloadError("OpenAI function call is missing an id");
      }
      toolCalls.push({
        id,
        name: item.name,
        input: parseToolArguments(item.arguments),
      });
    }
  }
  const text = texts.join("");
  const usage = normalizeUsage(payload.usage);
  let output: unknown = text;
  if (structured) {
    try {
      output = JSON.parse(text);
    } catch {
      throw new OpenAIResponsesPayloadError(
        "OpenAI structured response did not contain valid JSON",
      );
    }
  }
  return {
    output: output as T,
    ...(text.length === 0 ? {} : { text }),
    ...(toolCalls.length === 0 ? {} : { toolCalls }),
    ...(usage === undefined ? {} : { usage }),
    latencyMs,
    ...(typeof payload.id === "string" ? { providerResponseId: payload.id } : {}),
  };
}

function normalizeUsage(value: unknown): AiUsage | undefined {
  if (!isRecord(value)) return undefined;
  return {
    ...(typeof value.input_tokens === "number"
      ? { inputTokens: value.input_tokens }
      : {}),
    ...(typeof value.output_tokens === "number"
      ? { outputTokens: value.output_tokens }
      : {}),
    ...(typeof value.total_tokens === "number"
      ? { totalTokens: value.total_tokens }
      : {}),
  };
}

function parseToolArguments(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new OpenAIResponsesPayloadError(
      `OpenAI Responses API returned invalid JSON with status ${response.status}`,
    );
  }
}

function providerErrorMessage(payload: unknown): string | undefined {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined;
  return typeof payload.error.message === "string"
    ? payload.error.message
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
