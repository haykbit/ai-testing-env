import { resolve } from "node:path";
import { FileRunRepository } from "@ai-testing-env/core";
import { startDashboardServer } from "./server.js";

const runsDirectory = resolve(process.argv[2] ?? ".ai-test/runs");
const server = await startDashboardServer({
  repository: new FileRunRepository(runsDirectory),
});

console.log(`ai-testing-env dashboard: ${server.url}`);
console.log(`run repository: ${runsDirectory}`);

async function shutdown(): Promise<void> {
  await server.close();
  process.exitCode = 0;
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());
