import { randomUUID } from "node:crypto";
import type {
  EvaluationResult,
  Evaluator,
  ExecutionProfile,
  FlowDefinition,
  RunTrace,
  ScenarioDefinition,
  SerializedError,
  StepTrace,
  Verdict,
} from "./types.js";
import {
  assertCapabilitiesAllowed,
  assertLiveExecutionAuthorized,
  defaultExecutionProfile,
} from "./profiles.js";

export interface RunOptions {
  projectId: string;
  runId?: string;
  now?: () => Date;
  profile?: ExecutionProfile;
  allowLive?: boolean;
}

async function runEvaluators<T>(
  evaluators: readonly Evaluator<T>[],
  value: T,
  input: unknown,
  metadata: Readonly<Record<string, unknown>>,
): Promise<EvaluationResult[]> {
  return Promise.all(
    evaluators.map(async (evaluator) => {
      try {
        return await evaluator.evaluate({ value, input, metadata });
      } catch (error) {
        const serialized = serializeError(error);
        return {
          name: evaluator.name,
          passed: false,
          message: `Evaluator errored: ${serialized.message}`,
        };
      }
    }),
  );
}

function verdictFor(evaluations: readonly EvaluationResult[]): Verdict {
  return evaluations.every((evaluation) => evaluation.passed) ? "passed" : "failed";
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: "Error", message: String(error) };
}

export async function runScenario<TInput, TOutput>(
  flow: FlowDefinition<TInput, TOutput>,
  scenario: ScenarioDefinition<TInput>,
  options: RunOptions,
): Promise<RunTrace> {
  const now = options.now ?? (() => new Date());
  const profile = options.profile ?? defaultExecutionProfile;
  const startedAt = now();
  const steps: StepTrace[] = [];
  let output: TOutput | undefined;
  let error: SerializedError | undefined;
  let evaluations: EvaluationResult[] = [];

  try {
    output = await flow.execute(
      {
        async step(definition, operation) {
          const stepStartedAt = now();
          const metadata = { ...definition.metadata };
          const capabilities = [...(definition.capabilities ?? [])];
          try {
            assertCapabilitiesAllowed(profile, capabilities);
            assertLiveExecutionAuthorized(
              profile,
              capabilities,
              options.allowLive === true,
            );
            const value = await operation();
            const stepEvaluations = await runEvaluators(
              definition.evaluators ?? [],
              value,
              definition.input,
              metadata,
            );
            const stepFinishedAt = now();
            steps.push({
              id: definition.id,
              name: definition.name ?? definition.id,
              kind: definition.kind,
              status: verdictFor(stepEvaluations),
              startedAt: stepStartedAt.toISOString(),
              finishedAt: stepFinishedAt.toISOString(),
              durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
              ...(definition.input === undefined ? {} : { input: definition.input }),
              output: value,
              metadata,
              evaluations: stepEvaluations,
              capabilities,
            });
            return value;
          } catch (stepError) {
            const stepFinishedAt = now();
            steps.push({
              id: definition.id,
              name: definition.name ?? definition.id,
              kind: definition.kind,
              status: "errored",
              startedAt: stepStartedAt.toISOString(),
              finishedAt: stepFinishedAt.toISOString(),
              durationMs: stepFinishedAt.getTime() - stepStartedAt.getTime(),
              ...(definition.input === undefined ? {} : { input: definition.input }),
              metadata,
              evaluations: [],
              capabilities,
              error: serializeError(stepError),
            });
            throw stepError;
          }
        },
      },
      scenario.input,
    );
    evaluations = await runEvaluators(
      flow.evaluators ?? [],
      output,
      scenario.input,
      {},
    );
  } catch (runError) {
    error = serializeError(runError);
  }

  const finishedAt = now();
  const stepFailed = steps.some((step) => step.status === "failed");
  const status: Verdict = error
    ? "errored"
    : stepFailed || verdictFor(evaluations) === "failed"
      ? "failed"
      : "passed";

  return {
    schemaVersion: 1,
    id: options.runId ?? randomUUID(),
    projectId: options.projectId,
    profileId: profile.id,
    flowId: flow.id,
    scenarioId: scenario.id,
    status,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    input: scenario.input,
    ...(output === undefined ? {} : { output }),
    steps,
    evaluations,
    ...(error === undefined ? {} : { error }),
    tags: [...(scenario.tags ?? [])],
  };
}

