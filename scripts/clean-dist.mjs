import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.cwd(), "dist");
await rm(directory, { recursive: true, force: true });
