export type StepKind = "ai" | "code" | "http" | "database";

export type Verdict = "passed" | "failed" | "errored";

export type ResourceCapability = "network" | "write" | "spend";

export type ProfileMode = "mocked" | "recorded" | "integration" | "live";

export interface ResourcePolicy {
  network: boolean;
  write: boolean;
  spend: boolean;
}

export interface ExecutionProfile {
  id: string;
  mode: ProfileMode;
  capabilities: ResourcePolicy;
}

export interface RedactionConfig {
  sensitiveKeys?: readonly string[];
  sensitiveValues?: readonly string[];
  replacement?: string;
}

export interface EvaluationResult {
  name: string;
  passed: boolean;
  message?: string;
  explanation?: string;
  score?: number;
  expected?: unknown;
  actual?: unknown;
  metadata?: Record<string, unknown>;
  error?: SerializedError;
}

export interface EvaluationContext<T> {
  value: T;
  input: unknown;
  metadata: Readonly<Record<string, unknown>>;
}

export interface Evaluator<T> {
  name: string;
  evaluate(context: EvaluationContext<T>): EvaluationResult | Promise<EvaluationResult>;
}

export interface StepDefinition<T> {
  id: string;
  name?: string;
  kind: StepKind;
  input?: unknown;
  metadata?: Record<string, unknown>;
  evaluators?: readonly Evaluator<T>[];
  capabilities?: readonly ResourceCapability[];
}

export interface StepTrace {
  id: string;
  name: string;
  kind: StepKind;
  status: Verdict;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  input?: unknown;
  output?: unknown;
  metadata: Record<string, unknown>;
  evaluations: EvaluationResult[];
  capabilities: ResourceCapability[];
  error?: SerializedError;
}

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export interface RunTrace {
  schemaVersion: 1;
  id: string;
  projectId: string;
  profileId: string;
  flowId: string;
  scenarioId: string;
  status: Verdict;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  input: unknown;
  output?: unknown;
  steps: StepTrace[];
  evaluations: EvaluationResult[];
  error?: SerializedError;
  tags: string[];
  sourceRunId?: string;
}

export interface RunEvaluator {
  id: string;
  name?: string;
  capabilities?: readonly ResourceCapability[];
  evaluate(run: Readonly<RunTrace>): EvaluationResult | Promise<EvaluationResult>;
}

export interface FlowContext {
  step<T>(definition: StepDefinition<T>, operation: () => Promise<T> | T): Promise<T>;
}

export interface FlowDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  name?: string;
  execute(context: FlowContext, input: TInput): Promise<TOutput> | TOutput;
  evaluators?: readonly Evaluator<TOutput>[];
}

export interface ScenarioDefinition<TInput = unknown> {
  id: string;
  name?: string;
  flowId: string;
  input: TInput;
  tags?: readonly string[];
  profileId?: string;
}

export interface ProjectDefinition {
  id: string;
  flows: readonly FlowDefinition<any, any>[];
  scenarios: readonly ScenarioDefinition<any>[];
  profiles?: readonly ExecutionProfile[];
  evaluations?: readonly RunEvaluator[];
  allowLive?: boolean;
  redaction?: RedactionConfig;
}

export interface RunRepository {
  save(run: RunTrace): Promise<void>;
  list(): Promise<RunTrace[]>;
  get(id: string): Promise<RunTrace | undefined>;
}

