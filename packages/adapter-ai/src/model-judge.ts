import {
  redactValue,
  type RedactionConfig,
  type RunEvaluator,
  type RunTrace,
} from "@ai-testing-env/core";
import type { AiAdapter, AiRequest, AiResponse } from "./types.js";

export interface ModelJudgeRubric {
  id: string;
  version: string;
  instructions: string;
  scale: {
    min: number;
    max: number;
  };
  passingScore: number;
}

export interface ModelJudgeOptions {
  id: string;
  name?: string;
  model: string;
  rubric: ModelJudgeRubric;
  adapter: AiAdapter;
  redaction?: RedactionConfig;
  selectEvidence?: (run: Readonly<RunTrace>) => unknown;
}

export interface ModelJudgeOutput {
  score: number;
  explanation: string;
}

export function createModelJudge(options: ModelJudgeOptions): RunEvaluator {
  validateRubric(options.rubric);
  return {
    id: options.id,
    ...(options.name === undefined ? {} : { name: options.name }),
    capabilities: options.adapter.capabilities,
    async evaluate(run) {
      const request = judgeRequest(options, run);
      const response = await options.adapter.execute<ModelJudgeOutput>(request);
      const judgment = validateJudgment(response.output, options.rubric);
      return {
        name: options.name ?? options.id,
        passed: judgment.score >= options.rubric.passingScore,
        score: judgment.score,
        message: judgment.explanation,
        explanation: judgment.explanation,
        expected: { minimumScore: options.rubric.passingScore },
        actual: { score: judgment.score },
        metadata: judgeMetadata(options, response),
      };
    },
  };
}

function judgeRequest(
  options: ModelJudgeOptions,
  run: Readonly<RunTrace>,
): AiRequest {
  const evidence = redactValue(
    options.selectEvidence?.(run) ?? run,
    options.redaction,
  );
  return {
    model: options.model,
    messages: [
      {
        role: "system",
        content: [
          "Evaluate the supplied test evidence using only this rubric.",
          `Rubric id: ${options.rubric.id}`,
          `Rubric version: ${options.rubric.version}`,
          `Scale: ${options.rubric.scale.min} to ${options.rubric.scale.max}`,
          `Instructions: ${options.rubric.instructions}`,
          "Return a score and a concise explanation.",
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(evidence) },
    ],
    responseSchema: {
      type: "object",
      properties: {
        score: { type: "number" },
        explanation: { type: "string" },
      },
      required: ["score", "explanation"],
      additionalProperties: false,
    },
    metadata: {
      evaluationId: options.id,
      rubricId: options.rubric.id,
      rubricVersion: options.rubric.version,
    },
  };
}

function judgeMetadata(
  options: ModelJudgeOptions,
  response: AiResponse,
): Record<string, unknown> {
  return {
    judge: {
      provider: options.adapter.provider,
      adapterMode: options.adapter.mode,
      model: options.model,
      rubricId: options.rubric.id,
      rubricVersion: options.rubric.version,
      scale: options.rubric.scale,
      passingScore: options.rubric.passingScore,
      ...(response.usage === undefined ? {} : { usage: response.usage }),
      ...(response.latencyMs === undefined ? {} : { latencyMs: response.latencyMs }),
      ...(response.providerResponseId === undefined
        ? {}
        : { providerResponseId: response.providerResponseId }),
    },
  };
}

function validateRubric(rubric: ModelJudgeRubric): void {
  if (rubric.id.length === 0 || rubric.version.length === 0) {
    throw new ModelJudgeConfigurationError("Rubric id and version are required");
  }
  if (
    !Number.isFinite(rubric.scale.min)
    || !Number.isFinite(rubric.scale.max)
    || rubric.scale.min >= rubric.scale.max
    || rubric.passingScore < rubric.scale.min
    || rubric.passingScore > rubric.scale.max
  ) {
    throw new ModelJudgeConfigurationError(
      "Rubric scale and passing score are invalid",
    );
  }
}

function validateJudgment(
  value: unknown,
  rubric: ModelJudgeRubric,
): ModelJudgeOutput {
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as Record<string, unknown>).score !== "number"
    || typeof (value as Record<string, unknown>).explanation !== "string"
  ) {
    throw new ModelJudgeResponseError(
      "Model judge response must contain numeric score and string explanation",
    );
  }
  const score = (value as Record<string, unknown>).score as number;
  if (!Number.isFinite(score) || score < rubric.scale.min || score > rubric.scale.max) {
    throw new ModelJudgeResponseError(
      `Model judge score must be between ${rubric.scale.min} and ${rubric.scale.max}`,
    );
  }
  return {
    score,
    explanation: (value as Record<string, unknown>).explanation as string,
  };
}

export class ModelJudgeConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelJudgeConfigurationError";
  }
}

export class ModelJudgeResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelJudgeResponseError";
  }
}
