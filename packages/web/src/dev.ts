import { resolve } from "node:path";
import { FileRunRepository } from "@ai-testing-env/core";
import { loadProject } from "ai-testing-env";
import { startDashboardServer } from "./server.js";

const runsDirectory = resolve(process.argv[2] ?? ".ai-test/runs");
const configPath = process.argv[3];
const project = configPath === undefined
  ? undefined
  : await loadProject({ configPath });
const server = await startDashboardServer({
  repository: new FileRunRepository(runsDirectory),
  ...(project === undefined ? {} : { project }),
});

console.log(`ai-testing-env dashboard: ${server.url}`);
console.log(`run repository: ${runsDirectory}`);
if (project !== undefined) console.log(`project: ${project.id}`);

async function shutdown(): Promise<void> {
  await server.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
