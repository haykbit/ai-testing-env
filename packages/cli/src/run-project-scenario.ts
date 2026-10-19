import {
  FileRunRepository,
  resolveExecutionProfile,
  runScenario,
  type ProjectDefinition,
  type RunRepository,
  type RunTrace,
} from "@ai-testing-env/core";

export interface RunProjectScenarioOptions {
  repository?: RunRepository;
  runsDirectory?: string;
  runId?: string;
  profileId?: string;
}

export async function runProjectScenario(
  project: ProjectDefinition,
  scenarioId: string,
  options: RunProjectScenarioOptions = {},
): Promise<RunTrace> {
  const scenario = project.scenarios.find((entry) => entry.id === scenarioId);
  if (scenario === undefined) {
    throw new Error(`Unknown Scenario: ${scenarioId}`);
  }
  const flow = project.flows.find((entry) => entry.id === scenario.flowId);
  if (flow === undefined) {
    throw new Error(
      `Scenario ${scenario.id} references unknown Flow ${scenario.flowId}`,
    );
  }

  const run = await runScenario(flow, scenario, {
    projectId: project.id,
    profile: resolveExecutionProfile(
      project,
      options.profileId ?? scenario.profileId,
    ),
    ...(options.runId === undefined ? {} : { runId: options.runId }),
  });
  const repository = options.repository ?? new FileRunRepository(
    options.runsDirectory ?? ".ai-test/runs",
  );
  await repository.save(run);
  return run;
}
