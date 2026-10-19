import { randomUUID } from "node:crypto";
import type {
  EvaluationResult,
  ExecutionProfile,
  RunEvaluator,
  RunTrace,
  SerializedError,
} from "./types.js";
import {
  assertCapabilitiesAllowed,
  assertLiveExecutionAuthorized,
  defaultExecutionProfile,
} from "./profiles.js";

export interface ReevaluateRunOptions {
  runId?: string;
  now?: () => Date;
  profile?: ExecutionProfile;
  allowLive?: boolean;
}

export async function reevaluateRun(
  source: RunTrace,
  evaluators: readonly RunEvaluator[],
  options: ReevaluateRunOptions = {},
): Promise<RunTrace> {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const immutableSource = deepFreeze(structuredClone(source));
  const profile = options.profile ?? defaultExecutionProfile;
  const evaluations: EvaluationResult[] = [];

  for (const evaluator of evaluators) {
    try {
      const capabilities = evaluator.capabilities ?? [];
      assertCapabilitiesAllowed(profile, capabilities);
      assertLiveExecutionAuthorized(
        profile,
        capabilities,
        options.allowLive === true,
      );
      const result = await evaluator.evaluate(immutableSource);
      evaluations.push({ ...result, name: evaluator.name ?? result.name });
    } catch (error) {
      const serialized = serializeError(error);
      evaluations.push({
        name: evaluator.name ?? evaluator.id,
        passed: false,
        message: `Evaluator errored: ${serialized.message}`,
        error: serialized,
      });
    }
  }

  const finishedAt = now();
  return {
    schemaVersion: 1,
    id: options.runId ?? randomUUID(),
    projectId: source.projectId,
    profileId: source.profileId,
    flowId: source.flowId,
    scenarioId: source.scenarioId,
    status: evaluations.some((evaluation) => evaluation.error !== undefined)
      ? "errored"
      : evaluations.every((evaluation) => evaluation.passed)
        ? "passed"
        : "failed",
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    input: { sourceRunId: source.id },
    steps: [],
    evaluations,
    tags: [...source.tags, "reevaluation"],
    sourceRunId: source.id,
  };
}

function deepFreeze<T>(value: T): Readonly<T> {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return value;
}

function serializeError(error: unknown): SerializedError {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "Error", message: String(error) };
}
