import type {
  FlowDefinition,
  ProjectDefinition,
  ScenarioDefinition,
} from "./types.js";
import { builtInProfiles, defineProfile } from "./profiles.js";

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
  const profileIds = new Set(builtInProfiles.map((profile) => profile.id));
  const evaluationIds = new Set<string>();

  for (const flow of definition.flows) {
    if (flowIds.has(flow.id)) {
      throw new Error(`Duplicate flow id: ${flow.id}`);
    }
    flowIds.add(flow.id);
  }

  for (const profile of definition.profiles ?? []) {
    defineProfile(profile);
    if (profileIds.has(profile.id)) {
      throw new Error(`Duplicate profile id: ${profile.id}`);
    }
    profileIds.add(profile.id);
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
    if (
      scenario.profileId !== undefined
      && !profileIds.has(scenario.profileId)
    ) {
      throw new Error(
        `Scenario ${scenario.id} references unknown profile ${scenario.profileId}`,
      );
    }
    scenarioIds.add(scenario.id);
  }

  for (const evaluation of definition.evaluations ?? []) {
    if (typeof evaluation.id !== "string" || evaluation.id.length === 0) {
      throw new Error("Evaluation id must be a non-empty string");
    }
    if (evaluationIds.has(evaluation.id)) {
      throw new Error(`Duplicate evaluation id: ${evaluation.id}`);
    }
    if (typeof evaluation.evaluate !== "function") {
      throw new Error(`Evaluation ${evaluation.id} must define evaluate`);
    }
    evaluationIds.add(evaluation.id);
  }

  return definition;
}

