import type {
  FlowDefinition,
  ProjectDefinition,
  ScenarioDefinition,
} from "./types.js";

export function defineFlow<TInput, TOutput>(
  definition: FlowDefinition<TInput, TOutput>,
): FlowDefinition<TInput, TOutput> {
  return definition;
}

export function defineScenario<TInput>(
  definition: ScenarioDefinition<TInput>,
): ScenarioDefinition<TInput> {
  return definition;
}

export function defineProject(definition: ProjectDefinition): ProjectDefinition {
  const flowIds = new Set<string>();
  const scenarioIds = new Set<string>();

  for (const flow of definition.flows) {
    if (flowIds.has(flow.id)) {
      throw new Error(`Duplicate flow id: ${flow.id}`);
    }
    flowIds.add(flow.id);
  }

  for (const scenario of definition.scenarios) {
    if (scenarioIds.has(scenario.id)) {
      throw new Error(`Duplicate scenario id: ${scenario.id}`);
    }
    if (!flowIds.has(scenario.flowId)) {
      throw new Error(
        `Scenario ${scenario.id} references unknown flow ${scenario.flowId}`,
      );
    }
    scenarioIds.add(scenario.id);
  }

  return definition;
}

