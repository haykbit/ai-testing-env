import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { RunRepository, RunTrace } from "./types.js";
import { redactRunTrace } from "./redaction.js";

export class FileRunRepository implements RunRepository {
  constructor(private readonly directory: string) {}

  async save(run: RunTrace): Promise<void> {
    assertSafeRunId(run.id);
    const redactedRun = redactRunTrace(run);
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      join(this.directory, `${run.id}.json`),
      `${JSON.stringify(redactedRun, null, 2)}\n`,
      "utf8",
    );
  }

  async list(): Promise<RunTrace[]> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const runs = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => this.read(join(this.directory, entry.name))),
    );
    return runs.sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async get(id: string): Promise<RunTrace | undefined> {
    if (!isSafeRunId(id)) {
      return undefined;
    }
    try {
      return await this.read(join(this.directory, `${id}.json`));
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  private async read(path: string): Promise<RunTrace> {
    const stored = JSON.parse(await readFile(path, "utf8")) as RunTrace;
    return redactRunTrace({
      ...stored,
      profileId: stored.profileId ?? "mocked",
      steps: stored.steps.map((step) => ({
        ...step,
        capabilities: step.capabilities ?? [],
      })),
    });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

function isSafeRunId(id: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id);
}

function assertSafeRunId(id: string): void {
  if (!isSafeRunId(id)) {
    throw new Error(`Invalid run id: ${id}`);
  }
}

