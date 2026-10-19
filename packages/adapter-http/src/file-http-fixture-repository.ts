import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { HttpFixtureCorruptError } from "./adapters.js";
import type { HttpFixture, HttpFixtureRepository } from "./types.js";

export class FileHttpFixtureRepository implements HttpFixtureRepository {
  constructor(private readonly directory: string) {}

  async get(key: string): Promise<HttpFixture | undefined> {
    assertKey(key);
    try {
      const content = await readFile(join(this.directory, `${key}.json`), "utf8");
      let parsed: unknown;
      try {
        parsed = JSON.parse(content);
      } catch {
        throw new HttpFixtureCorruptError(key, "file is not valid JSON");
      }
      assertFixture(parsed, key);
      return parsed;
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    }
  }

  async save(fixture: HttpFixture): Promise<void> {
    assertFixture(fixture, fixture.key);
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      join(this.directory, `${fixture.key}.json`),
      `${JSON.stringify(fixture, null, 2)}\n`,
      "utf8",
    );
  }
}

function assertFixture(value: unknown, key: string): asserts value is HttpFixture {
  if (
    !isRecord(value)
    || value.schemaVersion !== 1
    || value.key !== key
    || typeof value.recordedAt !== "string"
    || !isRecord(value.request)
    || !isRecord(value.response)
    || typeof value.response.status !== "number"
  ) {
    throw new HttpFixtureCorruptError(key, "fixture schema is invalid");
  }
  assertKey(key);
}

function assertKey(key: string): void {
  if (!/^[a-f0-9]{64}$/.test(key)) {
    throw new Error(`Invalid HTTP fixture key: ${key}`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
