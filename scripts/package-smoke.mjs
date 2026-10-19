import { execFile } from "node:child_process";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const workspace = resolve(import.meta.dirname, "..");
const temporary = await mkdtemp(join(tmpdir(), "ai-testing-env-package-smoke-"));
const packDirectory = join(temporary, "packs");
const installDirectory = join(temporary, "clean-project");
const auditDirectory = join(temporary, "audit");
const packedDependencies = {};
const packageDirectories = [
  "packages/core",
  "packages/adapter-ai",
  "packages/adapter-http",
  "packages/adapter-database",
  "packages/cli",
  "packages/web",
];

try {
  await mkdir(packDirectory, { recursive: true });
  await mkdir(installDirectory, { recursive: true });
  await mkdir(auditDirectory, { recursive: true });

  for (const directory of packageDirectories) {
    await run("pnpm", [
      "--dir",
      join(workspace, directory),
      "pack",
      "--pack-destination",
      packDirectory,
    ]);
  }

  const tarballs = (await readdir(packDirectory))
    .filter((file) => file.endsWith(".tgz"))
    .sort()
    .map((file) => join(packDirectory, file));
  if (tarballs.length !== packageDirectories.length) {
    throw new Error(`Expected ${packageDirectories.length} tarballs, found ${tarballs.length}`);
  }

  for (const tarball of tarballs) {
    const { stdout: listing } = await run("tar", ["-tzf", tarball]);
    auditListing(tarball, listing.split(/\r?\n/).filter(Boolean));
    const destination = join(auditDirectory, basename(tarball, ".tgz"));
    await mkdir(destination, { recursive: true });
    await run("tar", ["-xzf", tarball, "-C", destination]);
    const extracted = join(destination, "package");
    await auditExtractedPackage(extracted);
    const manifest = JSON.parse(await readFile(join(extracted, "package.json"), "utf8"));
    packedDependencies[manifest.name] = `file:${tarball}`;
  }

  await writeFile(
    join(installDirectory, "package.json"),
    `${JSON.stringify({
      name: "clean-ai-testing-smoke",
      private: true,
      type: "module",
      dependencies: packedDependencies,
      pnpm: { overrides: packedDependencies },
    }, null, 2)}\n`,
    "utf8",
  );
  await run("pnpm", ["--dir", installDirectory, "install", "--offline"]);
  await run("node", [
    "--input-type=module",
    "--eval",
    "await import('ai-testing-env'); await import('@ai-testing-env/adapter-ai'); await import('@ai-testing-env/adapter-http'); await import('@ai-testing-env/adapter-database');",
  ], { cwd: installDirectory });

  await mkdir(join(installDirectory, ".ai-test"), { recursive: true });
  await writeFile(
    join(installDirectory, ".ai-test", "config.ts"),
    smokeConfig(),
    "utf8",
  );
  const { stdout } = await run(
    join(installDirectory, "node_modules", ".bin", "ai-test"),
    ["run", "smoke", "--json"],
    { cwd: installDirectory },
  );
  const execution = JSON.parse(stdout);
  if (execution.summary?.passed !== 1) {
    throw new Error(`Packaged CLI smoke failed: ${stdout}`);
  }
  const runId = execution.runs?.[0]?.id;
  if (typeof runId !== "string") throw new Error("Packaged CLI did not return a Run id");
  const runPath = join(installDirectory, ".ai-test", "runs", `${runId}.json`);
  const sourceBefore = await readFile(runPath, "utf8");
  const parsedRun = JSON.parse(sourceBefore);
  const kinds = new Set(parsedRun.steps.map((step) => step.kind));
  for (const kind of ["ai", "code", "http", "database"]) {
    if (!kinds.has(kind)) throw new Error(`Packaged smoke Run is missing ${kind} evidence`);
  }

  const reevaluated = await run(
    join(installDirectory, "node_modules", ".bin", "ai-test"),
    ["reevaluate", runId, "--evaluation", "output-ok", "--json"],
    { cwd: installDirectory },
  );
  const reevaluation = JSON.parse(reevaluated.stdout).run;
  if (reevaluation.sourceRunId !== runId || reevaluation.status !== "passed") {
    throw new Error("Packaged reevaluation did not link and pass");
  }
  if (await readFile(runPath, "utf8") !== sourceBefore) {
    throw new Error("Packaged reevaluation modified its source Run");
  }
  await access(join(installDirectory, "node_modules", ".bin", "ai-test-dashboard"));
  process.stdout.write(
    `Package smoke passed: ${tarballs.length} tarballs, clean install, 4 Step kinds, reevaluation\n`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}

async function run(command, args, options = {}) {
  try {
    return await exec(command, args, {
      cwd: options.cwd ?? workspace,
      maxBuffer: 10 * 1024 * 1024,
      env: process.env,
    });
  } catch (error) {
    const detail = [error.stdout, error.stderr].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed\n${detail}`, { cause: error });
  }
}

function auditListing(tarball, entries) {
  const forbidden = entries.filter((entry) =>
    entry.includes("/src/")
    || entry.includes("/node_modules/")
    || entry.includes("/.ai-test/")
    || entry.includes("/coverage/")
    || entry.includes("/fixtures/")
    || entry.endsWith(".map")
    || /\.test\.[cm]?[jt]sx?$/.test(entry)
  );
  if (forbidden.length > 0) {
    throw new Error(`Forbidden files in ${basename(tarball)}: ${forbidden.join(", ")}`);
  }
  if (!entries.includes("package/package.json") || !entries.includes("package/README.md")) {
    throw new Error(`${basename(tarball)} is missing package.json or README.md`);
  }
  if (!entries.some((entry) => entry.startsWith("package/dist/") && entry.endsWith(".js"))) {
    throw new Error(`${basename(tarball)} has no compiled JavaScript`);
  }
}

async function auditExtractedPackage(directory) {
  const manifest = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  if (manifest.engines?.node !== ">=20") {
    throw new Error(`${manifest.name} does not require Node >=20`);
  }
  if (JSON.stringify(manifest).includes("workspace:")) {
    throw new Error(`${manifest.name} contains an unresolved workspace dependency`);
  }
  if (!JSON.stringify(manifest.exports).includes("dist")) {
    throw new Error(`${manifest.name} does not publish compiled exports`);
  }
  const files = await walkFiles(directory);
  const credentialPattern = /-----BEGIN [A-Z ]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{16,}/;
  for (const file of files) {
    if (!/\.(?:js|json|md|d\.ts)$/.test(file)) continue;
    const value = await readFile(file, "utf8");
    if (credentialPattern.test(value)) {
      throw new Error(`Potential credential in packaged file ${file}`);
    }
  }
}

async function walkFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkFiles(path));
    else if (entry.isFile()) result.push(path);
  }
  return result;
}

function smokeConfig() {
  return `
import { defineFlow, defineProject, defineScenario } from "ai-testing-env";
import { MockAiAdapter, runAiStep } from "@ai-testing-env/adapter-ai";
import { MockHttpAdapter, runHttpStep } from "@ai-testing-env/adapter-http";
import { ManagedDatabaseAdapter, runDatabaseStep, withDatabaseResource } from "@ai-testing-env/adapter-database";

const ai = new MockAiAdapter(() => ({ output: { label: "ok" }, text: "ok" }));
const http = new MockHttpAdapter(() => ({ status: 200, headers: {}, body: { ok: true }, durationMs: 0 }));
const database = new ManagedDatabaseAdapter({
  mode: "mocked",
  resourceName: "smoke-memory",
  driver: {
    setup: () => new Map(),
    execute: (resource, operation) => { resource.set(operation.name, operation.parameters); return { rowsAffected: 1 }; },
    cleanup: (resource) => resource.clear(),
  },
});
const flow = defineFlow({
  id: "smoke-flow",
  async execute(context, input) {
    const value = await context.step({ id: "code", kind: "code", input }, () => ({ value: input.value.trim() }));
    await runAiStep(context, ai, { id: "ai", request: { model: "mock", prompt: value.value } });
    await runHttpStep(context, http, { id: "http", request: { method: "POST", url: "https://example.invalid", body: value } });
    await withDatabaseResource(context, database, () => runDatabaseStep(context, database, {
      id: "database", operation: { kind: "write", name: "store", parameters: value },
    }));
    return value;
  },
});
export default defineProject({
  id: "package-smoke",
  flows: [flow],
  scenarios: [defineScenario({ id: "smoke", flowId: flow.id, input: { value: " ok " }, tags: ["smoke"] })],
  evaluations: [{
    id: "output-ok",
    evaluate: (run) => ({ name: "output ok", passed: run.output?.value === "ok" }),
  }],
});
`;
}
