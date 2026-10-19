export type StepKind = "ai" | "code" | "http" | "database";

export type Verdict = "passed" | "failed" | "errored";

export interface EvaluationResult {
  name: string;
  passed: boolean;
  message?: string;
  score?: number;
  expected?: unknown;
  actual?: unknown;
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
}

export interface ProjectDefinition {
  id: string;
  flows: readonly FlowDefinition<any, any>[];
  scenarios: readonly ScenarioDefinition<any>[];
}

export interface RunRepository {
  save(run: RunTrace): Promise<void>;
  list(): Promise<RunTrace[]>;
  get(id: string): Promise<RunTrace | undefined>;
}

