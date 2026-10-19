import type {
  Evaluator,
  FlowContext,
  ResourceCapability,
} from "@ai-testing-env/core";

export type DatabaseOperationKind = "read" | "write";

export interface DatabaseOperation {
  kind: DatabaseOperationKind;
  name: string;
  statement?: string;
  parameters?: unknown;
}

export interface DatabaseResult<TRows = unknown> {
  rows?: TRows;
  rowsAffected?: number;
  durationMs: number;
}

export interface DatabaseLifecycleEvidence {
  resource: string;
  durationMs: number;
}

export interface DatabaseAdapter {
  readonly mode: "mocked" | "integration";
  readonly lifecycleCapabilities: readonly ResourceCapability[];
  capabilitiesFor(operation: DatabaseOperation): readonly ResourceCapability[];
  setup(): Promise<DatabaseLifecycleEvidence>;
  execute<TRows = unknown>(operation: DatabaseOperation): Promise<DatabaseResult<TRows>>;
  cleanup(): Promise<DatabaseLifecycleEvidence>;
}

export interface DatabaseDriver<TResource> {
  setup(): Promise<TResource> | TResource;
  execute<TRows = unknown>(
    resource: TResource,
    operation: DatabaseOperation,
  ): Promise<Omit<DatabaseResult<TRows>, "durationMs">> | Omit<DatabaseResult<TRows>, "durationMs">;
  cleanup(resource: TResource): Promise<void> | void;
}

export interface DatabaseStepDefinition<TRows> {
  id: string;
  name?: string;
  operation: DatabaseOperation;
  evaluators?: readonly Evaluator<DatabaseResult<TRows>>[];
}

export interface DatabaseLifecycleDefinition {
  id?: string;
  name?: string;
}

export type DatabaseFlowContext = Pick<FlowContext, "step">;
