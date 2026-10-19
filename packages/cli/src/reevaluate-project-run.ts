import {
  FileRunRepository,
  redactRunTrace,
  reevaluateRun,
  type ProjectDefinition,
  type RunRepository,
  type RunTrace,
} from "@ai-testing-env/core";

export interface ReevaluateProjectRunOptions {
  repository?: RunRepository;
  runsDirectory?: string;
  runId?: string;
}

export async function reevaluateProjectRun(
  project: ProjectDefinition,
  sourceRunId: string,
  evaluationIds: readonly string[],
  options: ReevaluateProjectRunOptions = {},
): Promise<RunTrace> {
  const repository = options.repository ?? new FileRunRepository(
    options.runsDirectory ?? ".ai-test/runs",
  );
  const source = await repository.get(sourceRunId);
  if (source === undefined) throw new Error(`Unknown Run: ${sourceRunId}`);
  if (source.projectId !== project.id) {
    throw new Error(
      `Run ${sourceRunId} belongs to Project ${source.projectId}, not ${project.id}`,
    );
  }
  const available = new Map(
    (project.evaluations ?? []).map((evaluation) => [evaluation.id, evaluation]),
  );
  const evaluators = evaluationIds.map((id) => {
    const evaluator = available.get(id);
    if (evaluator === undefined) throw new Error(`Unknown Evaluation: ${id}`);
    return evaluator;
  });
  const result = redactRunTrace(await reevaluateRun(source, evaluators, {
    ...(options.runId === undefined ? {} : { runId: options.runId }),
  }), project.redaction);
  await repository.save(result);
  return result;
}
