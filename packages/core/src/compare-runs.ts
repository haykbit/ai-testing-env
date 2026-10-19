import type { EvaluationResult, RunTrace, StepTrace } from "./types.js";

export interface ValueChange {
  changed: boolean;
  beforePresent: boolean;
  afterPresent: boolean;
  before?: unknown;
  after?: unknown;
}

export interface StepChange {
  id: string;
  change: "added" | "removed" | "changed" | "unchanged";
  before?: StepTrace;
  after?: StepTrace;
}

export interface EvaluationChange {
  name: string;
  change: "added" | "removed" | "changed" | "unchanged";
  before?: EvaluationResult;
  after?: EvaluationResult;
}

export interface RunComparison {
  compatible: boolean;
  compatibility: {
    project: boolean;
    flow: boolean;
    scenario: boolean;
  };
  leftRunId: string;
  rightRunId: string;
  output: ValueChange;
  steps: StepChange[];
  evaluations: EvaluationChange[];
  duration: { beforeMs: number; afterMs: number; deltaMs: number };
  tokens: ValueChange;
}

export function compareRuns(left: RunTrace, right: RunTrace): RunComparison {
  const compatibility = {
    project: left.projectId === right.projectId,
    flow: left.flowId === right.flowId,
    scenario: left.scenarioId === right.scenarioId,
  };
  return {
    compatible: Object.values(compatibility).every(Boolean),
    compatibility,
    leftRunId: left.id,
    rightRunId: right.id,
    output: valueChange(left, right, "output"),
    steps: compareByKey(left.steps, right.steps, (step) => step.id).map(
      (entry) => ({ id: entry.key, ...entry.change }),
    ),
    evaluations: compareByKey(
      left.evaluations,
      right.evaluations,
      (evaluation) => evaluation.name,
    ).map((entry) => ({ name: entry.key, ...entry.change })),
    duration: {
      beforeMs: left.durationMs,
      afterMs: right.durationMs,
      deltaMs: right.durationMs - left.durationMs,
    },
    tokens: compareOptionalValues(totalTokens(left), totalTokens(right)),
  };
}

function compareByKey<T>(
  before: readonly T[],
  after: readonly T[],
  key: (value: T) => string,
): Array<{
  key: string;
  change: {
    change: "added" | "removed" | "changed" | "unchanged";
    before?: T;
    after?: T;
  };
}> {
  const beforeMap = new Map(before.map((value) => [key(value), value]));
  const afterMap = new Map(after.map((value) => [key(value), value]));
  return [...new Set([...beforeMap.keys(), ...afterMap.keys()])]
    .sort()
    .map((entryKey) => {
      const left = beforeMap.get(entryKey);
      const right = afterMap.get(entryKey);
      return { key: entryKey, change: {
          change: left === undefined
            ? "added" as const
            : right === undefined
              ? "removed" as const
              : stableValue(left) === stableValue(right)
                ? "unchanged" as const
                : "changed" as const,
          ...(left === undefined ? {} : { before: left }),
          ...(right === undefined ? {} : { after: right }),
        } };
    });
}

function valueChange(
  before: RunTrace,
  after: RunTrace,
  key: "output",
): ValueChange {
  return compareOptionalValues(before[key], after[key]);
}

function compareOptionalValues(before: unknown, after: unknown): ValueChange {
  return {
    changed: stableValue(before) !== stableValue(after),
    beforePresent: before !== undefined,
    afterPresent: after !== undefined,
    ...(before === undefined ? {} : { before }),
    ...(after === undefined ? {} : { after }),
  };
}

function totalTokens(run: RunTrace): number | undefined {
  const values: number[] = [];
  visit(run.steps.map((step) => step.output), values);
  visit(run.evaluations.map((evaluation) => evaluation.metadata), values);
  return values.length === 0
    ? undefined
    : values.reduce((sum, value) => sum + value, 0);
}

function visit(value: unknown, tokens: number[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) visit(entry, tokens);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const [key, entry] of Object.entries(value)) {
    if (key === "totalTokens" && typeof entry === "number") tokens.push(entry);
    else visit(entry, tokens);
  }
}

function stableValue(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
}

