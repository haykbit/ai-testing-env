import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve, sep } from "node:path";

export interface DiscoveryLocation {
  file: string;
  line?: number;
}

export interface EndpointDiscovery extends DiscoveryLocation {
  method: string;
  path: string;
}

export interface ProjectDiscoveryReport {
  schemaVersion: 1;
  root: string;
  filesScanned: number;
  inventory: {
    languages: string[];
    aiSdks: string[];
    prompts: DiscoveryLocation[];
    schemas: DiscoveryLocation[];
    endpoints: EndpointDiscovery[];
    databaseClients: string[];
    testTools: string[];
    entrypoints: DiscoveryLocation[];
  };
  proposal: {
    configPath: ".ai-test/config.ts";
    status: "review-required";
    flowCandidates: Array<DiscoveryLocation & {
      confidence: "uncertain";
      reason: string;
    }>;
    scenarios: [];
    uncertainties: string[];
  };
}

export interface DiscoverProjectOptions {
  savePath?: string;
}

const excludedDirectories = new Set([
  ".git", ".next", ".turbo", "build", "coverage", "dist",
  "node_modules", "target", "vendor",
]);
const readableExtensions = new Set([
  ".cjs", ".css", ".go", ".graphql", ".gql", ".java", ".js", ".json",
  ".jsx", ".md", ".mjs", ".php", ".prisma", ".proto", ".py", ".rb", ".rs",
  ".sql", ".swift", ".toml", ".ts", ".tsx", ".yaml", ".yml",
]);

export async function discoverProject(
  root: string,
  options: DiscoverProjectOptions = {},
): Promise<ProjectDiscoveryReport> {
  const absoluteRoot = resolve(root);
  const files = await walk(absoluteRoot);
  const content = new Map<string, string>();
  for (const file of files) {
    try {
      content.set(file, await readFile(join(absoluteRoot, file), "utf8"));
    } catch {
      // Binary, unreadable, or concurrently removed files are not inventory input.
    }
  }
  const dependencyText = dependencySources(content);
  const entrypoints = discoverEntrypoints(content);
  const inventory = {
    languages: discoverLanguages([...content.keys()]),
    aiSdks: detectNames(dependencyText, aiSdkSignals),
    prompts: discoverNamedFiles([...content.keys()], /(^|[/_.-])prompts?([/_.-]|$)/i),
    schemas: discoverNamedFiles(
      [...content.keys()],
      /(^|[/_.-])(schema|schemas)([/_.-]|$)|\.(graphql|gql|proto|sql)$/i,
    ),
    endpoints: discoverEndpoints(content),
    databaseClients: detectNames(dependencyText, databaseSignals),
    testTools: detectNames(dependencyText, testToolSignals),
    entrypoints,
  };
  const uncertainties = [
    "Flow boundaries require review; discovery never executes or imports Project code.",
    ...(inventory.endpoints.length === 0
      ? ["No statically recognizable HTTP endpoints were found."]
      : []),
    ...(inventory.prompts.length === 0
      ? ["No prompt files were found; prompts may be inline or generated dynamically."]
      : []),
    ...(entrypoints.length === 0
      ? ["No conventional or manifest-declared entrypoints were found."]
      : []),
  ];
  const report: ProjectDiscoveryReport = {
    schemaVersion: 1,
    root: absoluteRoot,
    filesScanned: content.size,
    inventory,
    proposal: {
      configPath: ".ai-test/config.ts",
      status: "review-required",
      flowCandidates: entrypoints.map((entrypoint) => ({
        ...entrypoint,
        confidence: "uncertain",
        reason: "Existing entrypoint; confirm the business Flow boundary and inputs.",
      })),
      scenarios: [],
      uncertainties,
    },
  };
  if (options.savePath !== undefined) {
    const path = resolve(absoluteRoot, options.savePath);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  return report;
}

async function walk(root: string): Promise<string[]> {
  const files: string[] = [];
  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (excludedDirectories.has(entry.name)) continue;
        if (relative(root, absolute) === join(".ai-test", "runs")) continue;
        await visit(absolute);
      } else if (entry.isFile() && isReadableFile(entry.name)) {
        files.push(relative(root, absolute).split(sep).join("/"));
      }
    }
  }
  await visit(root);
  return files;
}

function isReadableFile(name: string): boolean {
  return readableExtensions.has(extname(name).toLowerCase())
    || /^requirements.*\.txt$/i.test(name)
    || name === "Dockerfile";
}

function dependencySources(content: ReadonlyMap<string, string>): string {
  return [...content]
    .filter(([file]) =>
      /(^|\/)(package\.json|requirements.*\.txt|pyproject\.toml|go\.mod|Cargo\.toml|Gemfile)$/i.test(file)
    )
    .map(([, value]) => value.toLowerCase())
    .join("\n");
}

function discoverLanguages(files: readonly string[]): string[] {
  const languages = new Set<string>();
  const signals: Record<string, string> = {
    ".go": "Go", ".java": "Java", ".js": "JavaScript", ".jsx": "JavaScript",
    ".php": "PHP", ".py": "Python", ".rb": "Ruby", ".rs": "Rust",
    ".swift": "Swift", ".ts": "TypeScript", ".tsx": "TypeScript",
  };
  for (const file of files) {
    const language = signals[extname(file).toLowerCase()];
    if (language !== undefined) languages.add(language);
  }
  return [...languages].sort();
}

const aiSdkSignals: ReadonlyArray<[string, RegExp]> = [
  ["Anthropic", /@anthropic-ai\/sdk|\banthropic\b/],
  ["Google Generative AI", /@google\/generative-ai|google-generativeai/],
  ["LangChain", /\blangchain\b/],
  ["OpenAI", /(^|[^a-z])openai([^a-z]|$)/],
  ["Vercel AI SDK", /"ai"\s*:/],
];
const databaseSignals: ReadonlyArray<[string, RegExp]> = [
  ["Drizzle", /drizzle-orm/], ["Knex", /\bknex\b/], ["MongoDB", /mongodb|mongoose/],
  ["MySQL", /mysql2|pymysql/], ["PostgreSQL", /"pg"\s*:|psycopg/],
  ["Prisma", /@prisma\/client|\bprisma\b/], ["SQLAlchemy", /sqlalchemy/],
  ["Sequelize", /sequelize/],
];
const testToolSignals: ReadonlyArray<[string, RegExp]> = [
  ["Jest", /\bjest\b/], ["Mocha", /\bmocha\b/], ["Node test", /node:test/],
  ["Playwright", /@playwright\/test/], ["pytest", /\bpytest\b/],
  ["RSpec", /\brspec\b/], ["Vitest", /\bvitest\b/],
];

function detectNames(
  source: string,
  signals: ReadonlyArray<readonly [string, RegExp]>,
): string[] {
  return signals.filter(([, pattern]) => pattern.test(source)).map(([name]) => name).sort();
}

function discoverNamedFiles(files: readonly string[], pattern: RegExp): DiscoveryLocation[] {
  return files.filter((file) => pattern.test(file)).sort().map((file) => ({ file }));
}

function discoverEntrypoints(content: ReadonlyMap<string, string>): DiscoveryLocation[] {
  const candidates = new Set<string>();
  const packageJson = content.get("package.json");
  if (packageJson !== undefined) {
    try {
      const parsed = JSON.parse(packageJson) as Record<string, unknown>;
      collectManifestPaths(parsed.main, candidates, content);
      collectManifestPaths(parsed.exports, candidates, content);
      collectManifestPaths(parsed.bin, candidates, content);
    } catch {
      // Invalid manifests are inventory evidence, not executable configuration.
    }
  }
  for (const file of content.keys()) {
    if (/(^|\/)(src\/)?(index|main|server|app)\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/i.test(file)) {
      candidates.add(file.replace(/^\.\//, ""));
    }
  }
  return [...candidates].sort().map((file) => ({ file }));
}

function collectManifestPaths(
  value: unknown,
  candidates: Set<string>,
  content: ReadonlyMap<string, string>,
): void {
  if (typeof value === "string") {
    const file = value.replace(/^\.\//, "");
    if (content.has(file)) candidates.add(file);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) collectManifestPaths(entry, candidates, content);
  }
}

function discoverEndpoints(content: ReadonlyMap<string, string>): EndpointDiscovery[] {
  const endpoints: EndpointDiscovery[] = [];
  const patterns = [
    /\b(?:app|router)\.(get|post|put|patch|delete|options|head)\s*\(\s*["'`]([^"'`]+)["'`]/i,
    /@(?:app\.)?(get|post|put|patch|delete)\s*\(\s*["'`]([^"'`]+)["'`]/i,
    /@(Get|Post|Put|Patch|Delete)\s*\(\s*["'`]([^"'`]+)["'`]/,
  ];
  for (const [file, source] of content) {
    source.split(/\r?\n/).forEach((line, index) => {
      for (const pattern of patterns) {
        const match = pattern.exec(line);
        if (match?.[1] !== undefined && match[2] !== undefined) {
          endpoints.push({
            file,
            line: index + 1,
            method: match[1].toUpperCase(),
            path: match[2],
          });
          break;
        }
      }
    });
  }
  return endpoints.sort((left, right) =>
    left.file.localeCompare(right.file) || (left.line ?? 0) - (right.line ?? 0)
  );
}
