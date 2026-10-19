import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { mkdtemp } from "node:fs/promises";
import { discoverProject } from "./discovery.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) =>
    rm(directory, { recursive: true, force: true })
  ));
});

describe("deterministic Project discovery", () => {
  it("inventories a TypeScript AI/API/database stack without executing it", async () => {
    const root = await fixture({
      "package.json": JSON.stringify({
        main: "./src/server.ts",
        dependencies: { openai: "1", express: "1", "@prisma/client": "1" },
        devDependencies: { vitest: "1" },
      }),
      "src/server.ts": `
        import { writeFileSync } from "node:fs";
        writeFileSync("executed", "bad");
        app.get("/health", handler);
      `,
      "src/prompts/system.prompt.md": "Be useful.",
      "prisma/schema.prisma": "model User { id Int @id }",
      "node_modules/ignored.ts": "router.post('/ignored', handler)",
      ".ai-test/runs/ignored.json": "{}",
    });

    const first = await discoverProject(root);
    const second = await discoverProject(root);

    assert.deepEqual(first, second);
    assert.deepEqual(first.inventory.languages, ["TypeScript"]);
    assert.deepEqual(first.inventory.aiSdks, ["OpenAI"]);
    assert.deepEqual(first.inventory.databaseClients, ["Prisma"]);
    assert.deepEqual(first.inventory.testTools, ["Vitest"]);
    assert.deepEqual(first.inventory.endpoints, [{
      file: "src/server.ts", line: 4, method: "GET", path: "/health",
    }]);
    assert.deepEqual(first.inventory.entrypoints, [{ file: "src/server.ts" }]);
    assert.deepEqual(first.inventory.schemas, [{ file: "prisma/schema.prisma" }]);
    assert.equal(first.proposal.status, "review-required");
    assert.equal(first.proposal.scenarios.length, 0);
    await assert.rejects(access(join(root, "executed")), { code: "ENOENT" });
    await assert.rejects(access(join(root, ".ai-test", "config.ts")), { code: "ENOENT" });
  });

  it("detects a Python stack and only saves a proposal when explicitly requested", async () => {
    const root = await fixture({
      "requirements.txt": "openai\nfastapi\nsqlalchemy\npytest\n",
      "app/main.py": `@app.post("/answers")\ndef answer(): pass`,
      "prompts/answer.md": "Answer clearly.",
    });

    const report = await discoverProject(root, {
      savePath: ".ai-test/discovery.json",
    });

    assert.deepEqual(report.inventory.languages, ["Python"]);
    assert.deepEqual(report.inventory.aiSdks, ["OpenAI"]);
    assert.deepEqual(report.inventory.databaseClients, ["SQLAlchemy"]);
    assert.deepEqual(report.inventory.testTools, ["pytest"]);
    assert.equal(report.inventory.endpoints[0]?.path, "/answers");
    await access(join(root, ".ai-test", "discovery.json"));
    await assert.rejects(access(join(root, ".ai-test", "config.ts")), { code: "ENOENT" });
  });

  it("returns explicit uncertainties for an empty supported Project", async () => {
    const root = await fixture({ "README.md": "No implementation yet." });

    const report = await discoverProject(root);

    assert.deepEqual(report.inventory.languages, []);
    assert.deepEqual(report.inventory.entrypoints, []);
    assert.deepEqual(report.proposal.flowCandidates, []);
    assert.ok(report.proposal.uncertainties.some((entry) =>
      entry.includes("No conventional")
    ));
  });
});

async function fixture(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "discovery-"));
  temporaryDirectories.push(root);
  for (const [file, content] of Object.entries(files)) {
    const path = join(root, file);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, content, "utf8");
  }
  return root;
}
