import type {
  DatabaseAdapter,
  DatabaseFlowContext,
  DatabaseLifecycleDefinition,
  DatabaseResult,
  DatabaseStepDefinition,
} from "./types.js";

export function runDatabaseStep<TRows>(
  context: DatabaseFlowContext,
  adapter: DatabaseAdapter,
  definition: DatabaseStepDefinition<TRows>,
): Promise<DatabaseResult<TRows>> {
  const { operation } = definition;
  return context.step(
    {
      id: definition.id,
      ...(definition.name === undefined ? {} : { name: definition.name }),
      kind: "database",
      input: {
        kind: operation.kind,
        name: operation.name,
        ...(operation.statement === undefined
          ? {}
          : { statement: operation.statement }),
        ...(operation.parameters === undefined
          ? {}
          : { parameters: operation.parameters }),
      },
      metadata: {
        adapterMode: adapter.mode,
        operation: operation.name,
        operationKind: operation.kind,
      },
      capabilities: adapter.capabilitiesFor(operation),
      ...(definition.evaluators === undefined
        ? {}
        : { evaluators: definition.evaluators }),
    },
    () => adapter.execute<TRows>(operation),
  );
}

export async function withDatabaseResource<T>(
  context: DatabaseFlowContext,
  adapter: DatabaseAdapter,
  callback: () => Promise<T> | T,
  definition: DatabaseLifecycleDefinition = {},
): Promise<T> {
  const id = definition.id ?? "database-resource";
  await context.step(
    {
      id: `${id}-setup`,
      name: definition.name === undefined
        ? "Set up database resource"
        : `Set up ${definition.name}`,
      kind: "database",
      metadata: { adapterMode: adapter.mode, lifecycle: "setup" },
      capabilities: adapter.lifecycleCapabilities,
    },
    () => adapter.setup(),
  );

  let callbackError: unknown;
  try {
    return await callback();
  } catch (error) {
    callbackError = error;
    throw error;
  } finally {
    try {
      await context.step(
        {
          id: `${id}-cleanup`,
          name: definition.name === undefined
            ? "Clean up database resource"
            : `Clean up ${definition.name}`,
          kind: "database",
          metadata: { adapterMode: adapter.mode, lifecycle: "cleanup" },
          capabilities: adapter.lifecycleCapabilities,
        },
        () => adapter.cleanup(),
      );
    } catch (cleanupError) {
      if (callbackError !== undefined) {
        throw new AggregateError(
          [callbackError, cleanupError],
          "Database operation and cleanup both failed",
        );
      }
      throw cleanupError;
    }
  }
}
