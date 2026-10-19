import type { EvaluationContext, EvaluationResult, Evaluator } from "./types.js";

export function evaluateWith<T>(
  name: string,
  predicate: (context: EvaluationContext<T>) => boolean | Promise<boolean>,
  message?: string,
): Evaluator<T> {
  return {
    name,
    async evaluate(context) {
      const passed = await predicate(context);
      return {
        name,
        passed,
        ...(passed || message === undefined ? {} : { message }),
      };
    },
  };
}

export function equals<T>(name: string, expected: T): Evaluator<T> {
  return {
    name,
    evaluate({ value }): EvaluationResult {
      const passed = JSON.stringify(value) === JSON.stringify(expected);
      return {
        name,
        passed,
        expected,
        actual: value,
        ...(passed ? {} : { message: "Value did not match the expected result" }),
      };
    },
  };
}

export function hasFields<T extends Record<string, unknown>>(
  name: string,
  fields: readonly (keyof T)[],
): Evaluator<T> {
  return evaluateWith(
    name,
    ({ value }) => fields.every((field) => field in value),
    `Missing one or more required fields: ${fields.join(", ")}`,
  );
}

export function matches(name: string, pattern: RegExp): Evaluator<string> {
  return evaluateWith(
    name,
    ({ value }) => pattern.test(value),
    `Value did not match ${pattern.toString()}`,
  );
}

