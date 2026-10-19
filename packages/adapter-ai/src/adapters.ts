import { redactValue, type RedactionConfig } from "@ai-testing-env/core";
import { aiFixtureKey } from "./fixture-key.js";
import type {
  AiAdapter,
  AiFixtureRepository,
  AiRequest,
  AiResponse,
  MockAiResponder,
} from "./types.js";

export class MockAiAdapter implements AiAdapter {
  readonly provider = "mock";
  readonly mode = "mocked" as const;
  readonly capabilities = [];

  constructor(private readonly responder: MockAiResponder) {}

  async execute<T = unknown>(request: AiRequest): Promise<AiResponse<T>> {
    return await this.responder(request) as AiResponse<T>;
  }
}

export interface RecordingAiAdapterOptions {
  delegate: AiAdapter;
  fixtures: AiFixtureRepository;
  redaction?: RedactionConfig;
  now?: () => Date;
}

export class RecordingAiAdapter implements AiAdapter {
  readonly mode = "record" as const;
  readonly provider: string;
  readonly capabilities;
  private readonly now: () => Date;

  constructor(private readonly options: RecordingAiAdapterOptions) {
    this.provider = options.delegate.provider;
    this.capabilities = options.delegate.capabilities;
    this.now = options.now ?? (() => new Date());
  }

  async execute<T = unknown>(request: AiRequest): Promise<AiResponse<T>> {
    const response = await this.options.delegate.execute<T>(request);
    const key = aiFixtureKey(request, this.options.redaction === undefined
      ? {}
      : { redaction: this.options.redaction });
    await this.options.fixtures.save({
      schemaVersion: 1,
      key,
      provider: this.provider,
      recordedAt: this.now().toISOString(),
      request: redactValue(request, this.options.redaction),
      response: redactValue(response, this.options.redaction),
    });
    return response;
  }
}

export interface ReplayAiAdapterOptions {
  fixtures: AiFixtureRepository;
  provider?: string;
  redaction?: RedactionConfig;
}

export class ReplayAiAdapter implements AiAdapter {
  readonly mode = "replay" as const;
  readonly capabilities = [];
  readonly provider: string;

  constructor(private readonly options: ReplayAiAdapterOptions) {
    this.provider = options.provider ?? "recorded";
  }

  async execute<T = unknown>(request: AiRequest): Promise<AiResponse<T>> {
    const key = aiFixtureKey(request, this.options.redaction === undefined
      ? {}
      : { redaction: this.options.redaction });
    const fixture = await this.options.fixtures.get(key);
    if (fixture === undefined) {
      throw new AiFixtureNotFoundError(key);
    }
    if (fixture.key !== key) {
      throw new AiFixtureCorruptError(key, "fixture key does not match request");
    }
    return fixture.response as AiResponse<T>;
  }
}

export class AiFixtureNotFoundError extends Error {
  constructor(readonly key: string) {
    super(`No recorded AI fixture for key ${key}`);
    this.name = "AiFixtureNotFoundError";
  }
}

export class AiFixtureCorruptError extends Error {
  constructor(readonly key: string, reason: string) {
    super(`Invalid AI fixture ${key}: ${reason}`);
    this.name = "AiFixtureCorruptError";
  }
}
