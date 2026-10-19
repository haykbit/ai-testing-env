import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  RunPage,
  RunQuery,
  RunRepository,
  RunTrace,
} from "./types.js";
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
    return runs.sort(compareRunOrder);
  }

  async query(query: RunQuery = {}): Promise<RunPage> {
    const limit = normalizeLimit(query.limit);
    const cursor = query.cursor === undefined
      ? undefined
      : decodeCursor(query.cursor);
    const filtered = (await this.list()).filter((run) =>
      (query.projectId === undefined || run.projectId === query.projectId)
      && (query.flowId === undefined || run.flowId === query.flowId)
      && (query.scenarioId === undefined || run.scenarioId === query.scenarioId)
      && (query.status === undefined || run.status === query.status)
      && (query.tags ?? []).every((tag) => run.tags.includes(tag))
      && (query.startedFrom === undefined || run.startedAt >= query.startedFrom)
      && (query.startedTo === undefined || run.startedAt <= query.startedTo)
      && (cursor === undefined || isAfterCursor(run, cursor))
    );
    const runs = filtered.slice(0, limit);
    const last = runs.at(-1);
    return {
      runs,
      ...(filtered.length > limit && last !== undefined
        ? { nextCursor: encodeCursor(last) }
        : {}),
    };
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

function compareRunOrder(left: RunTrace, right: RunTrace): number {
  return right.startedAt.localeCompare(left.startedAt)
    || left.id.localeCompare(right.id);
}

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Run query limit must be an integer between 1 and 100");
  }
  return limit;
}

interface RunCursor {
  startedAt: string;
  id: string;
}

function encodeCursor(run: RunTrace): string {
  return Buffer.from(JSON.stringify({
    startedAt: run.startedAt,
    id: run.id,
  }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string): RunCursor {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      typeof value !== "object"
      || value === null
      || typeof (value as Record<string, unknown>).startedAt !== "string"
      || typeof (value as Record<string, unknown>).id !== "string"
    ) throw new Error();
    return value as RunCursor;
  } catch {
    throw new Error("Invalid Run query cursor");
  }
}

function isAfterCursor(run: RunTrace, cursor: RunCursor): boolean {
  return run.startedAt < cursor.startedAt
    || (run.startedAt === cursor.startedAt && run.id > cursor.id);
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

