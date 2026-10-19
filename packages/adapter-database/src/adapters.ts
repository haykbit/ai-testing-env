import type { ResourceCapability } from "@ai-testing-env/core";
import type {
  DatabaseAdapter,
  DatabaseDriver,
  DatabaseLifecycleEvidence,
  DatabaseOperation,
  DatabaseResult,
} from "./types.js";

export interface ManagedDatabaseAdapterOptions<TResource> {
  mode: "mocked" | "integration";
  resourceName: string;
  driver: DatabaseDriver<TResource>;
  baseCapabilities?: readonly ResourceCapability[];
  now?: () => number;
}

export class ManagedDatabaseAdapter<TResource> implements DatabaseAdapter {
  readonly mode;
  readonly lifecycleCapabilities: readonly ResourceCapability[];
  private readonly baseCapabilities: readonly ResourceCapability[];
  private readonly now: () => number;
  private resource: TResource | undefined;

  constructor(private readonly options: ManagedDatabaseAdapterOptions<TResource>) {
    this.mode = options.mode;
    this.baseCapabilities = options.baseCapabilities
      ?? (options.mode === "integration" ? ["network"] : []);
    this.lifecycleCapabilities = options.mode === "integration"
      ? uniqueCapabilities([...this.baseCapabilities, "write"])
      : this.baseCapabilities;
    this.now = options.now ?? (() => Date.now());
  }

  capabilitiesFor(operation: DatabaseOperation): readonly ResourceCapability[] {
    if (this.mode === "mocked" || operation.kind === "read") {
      return this.baseCapabilities;
    }
    return uniqueCapabilities([...this.baseCapabilities, "write"]);
  }

  async setup(): Promise<DatabaseLifecycleEvidence> {
    if (this.resource !== undefined) {
      throw new DatabaseLifecycleError("Database resource is already set up");
    }
    const startedAt = this.now();
    this.resource = await this.options.driver.setup();
    return {
      resource: this.options.resourceName,
      durationMs: this.now() - startedAt,
    };
  }

  async execute<TRows = unknown>(
    operation: DatabaseOperation,
  ): Promise<DatabaseResult<TRows>> {
    if (this.resource === undefined) {
      throw new DatabaseLifecycleError("Database resource is not set up");
    }
    const startedAt = this.now();
    const result = await this.options.driver.execute<TRows>(this.resource, operation);
    return { ...result, durationMs: this.now() - startedAt };
  }

  async cleanup(): Promise<DatabaseLifecycleEvidence> {
    if (this.resource === undefined) {
      throw new DatabaseLifecycleError("Database resource is not set up");
    }
    const resource = this.resource;
    const startedAt = this.now();
    try {
      await this.options.driver.cleanup(resource);
    } finally {
      this.resource = undefined;
    }
    return {
      resource: this.options.resourceName,
      durationMs: this.now() - startedAt,
    };
  }
}

export class DatabaseLifecycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseLifecycleError";
  }
}

function uniqueCapabilities(
  capabilities: readonly ResourceCapability[],
): readonly ResourceCapability[] {
  return [...new Set(capabilities)];
}
