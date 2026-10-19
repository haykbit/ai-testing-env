import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  ProjectDefinition,
  EvaluationResult,
  RunRepository,
  RunTrace,
  StepTrace,
  Verdict,
  RunQuery,
} from "@ai-testing-env/core";
import { compareRuns } from "@ai-testing-env/core";
import {
  DashboardExecutionController,
  DashboardExecutionRequestError,
  type DashboardExecutionOptions,
  type DashboardProjectManifest,
} from "./execution-controller.js";

const dashboardScript = `
const form = document.querySelector("#launch-run");
const status = document.querySelector("#execution-status");
if (form && status) form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = new FormData(form);
  status.textContent = "Starting…";
  const response = await fetch("/api/executions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      scenarioId: data.get("scenarioId"),
      profileId: data.get("profileId"),
      allowLive: data.get("allowLive") === "on",
    }),
  });
  const payload = await response.json();
  if (!response.ok) { status.textContent = payload.error; return; }
  status.textContent = payload.execution.status;
  const poll = async () => {
    const current = await fetch("/api/executions/" + encodeURIComponent(payload.execution.id));
    const body = await current.json();
    const execution = body.execution;
    status.textContent = execution.status + (execution.verdict ? " · " + execution.verdict : "");
    if (execution.status === "pending" || execution.status === "running") {
      setTimeout(poll, 150);
    } else if (execution.status === "completed") {
      status.innerHTML = "completed · " + execution.verdict + " · <a href=\"/runs/" + encodeURIComponent(execution.runId) + "\">open Run</a>";
    } else if (execution.error) status.textContent += " · " + execution.error;
  };
  setTimeout(poll, 0);
});
`;

const dashboardStyles = `
:root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #0b0d10; color: #f4f6f8; }
* { box-sizing: border-box; }
body { margin: 0; min-height: 100vh; background: radial-gradient(circle at top left, #18202c 0, #0b0d10 42rem); }
a { color: inherit; }
.shell { width: min(1120px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
.eyebrow { color: #8f9baa; font-size: 12px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; }
h1 { margin: 8px 0 10px; font-size: clamp(32px, 5vw, 56px); letter-spacing: -.045em; }
.lede { max-width: 680px; color: #aeb7c3; font-size: 17px; line-height: 1.6; }
.summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 32px 0; }
.metric, .panel { border: 1px solid #252b34; background: rgba(18, 22, 28, .88); box-shadow: 0 18px 60px rgba(0, 0, 0, .22); }
.metric { border-radius: 16px; padding: 18px; }
.metric strong { display: block; margin-top: 8px; font-size: 28px; }
.panel { overflow: hidden; border-radius: 20px; }
.panel-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 20px 22px; border-bottom: 1px solid #252b34; }
.panel-header h2 { margin: 0; font-size: 18px; }
.run-list { display: grid; }
.run { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr) 110px 100px; gap: 18px; align-items: center; padding: 18px 22px; text-decoration: none; border-bottom: 1px solid #20262e; }
.run:last-child { border-bottom: 0; }
.run:hover { background: #171c23; }
.run strong, .run span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.muted { color: #8f9baa; }
.pill { display: inline-flex; width: fit-content; align-items: center; gap: 7px; border-radius: 999px; padding: 5px 10px; font-size: 12px; font-weight: 700; }
.pill::before { width: 7px; height: 7px; border-radius: 50%; background: currentColor; content: ""; }
.passed { color: #5ee9a6; background: rgba(48, 171, 111, .13); }
.failed { color: #ffc857; background: rgba(224, 162, 45, .13); }
.errored { color: #ff7a8a; background: rgba(212, 62, 82, .14); }
.empty { padding: 48px 22px; text-align: center; color: #8f9baa; }
.back { display: inline-flex; margin-bottom: 28px; color: #aeb7c3; text-decoration: none; }
.back:hover { color: #fff; }
.detail-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
.detail-head h1 { font-size: clamp(30px, 4vw, 46px); }
.meta { display: flex; flex-wrap: wrap; gap: 9px 18px; margin: 22px 0 32px; color: #aeb7c3; font-size: 14px; }
.steps { display: grid; gap: 14px; }
.step { padding: 20px 22px; }
.step-head { display: flex; justify-content: space-between; gap: 18px; align-items: center; }
.step h3 { margin: 0; font-size: 16px; }
.kind { margin-left: 8px; color: #8f9baa; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; }
.payload-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 16px; }
.payload { min-width: 0; padding: 14px; border-radius: 12px; background: #0c0f13; }
.payload h4 { margin: 0 0 10px; color: #8f9baa; font-size: 11px; letter-spacing: .1em; text-transform: uppercase; }
pre { margin: 0; overflow: auto; color: #dce3ec; font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.evaluations { display: grid; gap: 8px; margin-top: 14px; }
.evaluation { display: flex; justify-content: space-between; gap: 16px; padding: 10px 12px; border-radius: 10px; background: #0c0f13; font-size: 13px; }
.error { margin-top: 14px; padding: 14px; border: 1px solid rgba(255, 122, 138, .35); border-radius: 12px; color: #ff9aa6; background: rgba(212, 62, 82, .08); }
.launch-form { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 12px; align-items: end; padding: 20px 22px; }
.launch-form label { display: grid; gap: 7px; color: #aeb7c3; font-size: 12px; }
.launch-form select, .launch-form button { min-height: 40px; border: 1px solid #343c48; border-radius: 10px; padding: 0 12px; color: #f4f6f8; background: #0c0f13; }
.launch-form button { cursor: pointer; color: #07120c; font-weight: 800; background: #5ee9a6; }
.live-check { display: flex !important; grid-auto-flow: column; align-items: center; padding-bottom: 10px; }
.execution-status { padding: 0 22px 20px; }
@media (max-width: 760px) { .summary { grid-template-columns: repeat(2, 1fr); } .run { grid-template-columns: minmax(0, 1fr) auto; } .run .secondary { display: none; } .detail-head { display: grid; } .payload-grid { grid-template-columns: 1fr; } }
`;

export interface DashboardServerOptions {
  repository: RunRepository;
  project?: ProjectDefinition;
  execute?: DashboardExecutionOptions["execute"];
  host?: string;
  port?: number;
}

export interface RunningDashboardServer {
  host: string;
  port: number;
  url: string;
  close(): Promise<void>;
}

export interface RunSummary {
  id: string;
  projectId: string;
  profileId: string;
  flowId: string;
  scenarioId: string;
  status: Verdict;
  startedAt: string;
  durationMs: number;
  stepCount: number;
  tags: string[];
  sourceRunId?: string;
}

export function createDashboardServer(repository: RunRepository): Server {
  return createServer(createDashboardRequestListener(repository));
}

export function createDashboardRequestListener(
  repository: RunRepository,
  controller?: DashboardExecutionController,
): RequestListener {
  return (request, response) => {
    void routeRequest(repository, controller, request, response).catch((error: unknown) => {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      sendJson(response, 500, { error: "Unable to read the run repository" });
    });
  };
}

export async function startDashboardServer(
  options: DashboardServerOptions,
): Promise<RunningDashboardServer> {
  const host = options.host ?? "127.0.0.1";
  const controller = options.project === undefined
    ? undefined
    : new DashboardExecutionController({
        project: options.project,
        repository: options.repository,
        ...(options.execute === undefined ? {} : { execute: options.execute }),
      });
  const server = createServer(
    createDashboardRequestListener(options.repository, controller),
  );

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(options.port ?? 4317, host, () => {
      server.off("error", onError);
      resolve();
    });
  });

  const address = server.address() as AddressInfo;
  return {
    host,
    port: address.port,
    url: `http://${formatHostForUrl(host)}:${address.port}`,
    close: () => closeServer(server),
  };
}

async function routeRequest(
  repository: RunRepository,
  controller: DashboardExecutionController | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  if (request.method === "POST" && url.pathname === "/api/executions") {
    if (controller === undefined) {
      sendJson(response, 503, { error: "Dashboard execution is not configured" });
      return;
    }
    try {
      const input = await readExecutionRequest(request);
      const execution = controller.create(input);
      sendJson(response, 202, { execution });
    } catch (error) {
      if (error instanceof DashboardExecutionRequestError) {
        sendJson(response, error.status, { error: error.message });
        return;
      }
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: error.message });
        return;
      }
      throw error;
    }
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendJson(response, 405, { error: "Method not allowed" }, request.method === "HEAD");
    return;
  }

  const isHead = request.method === "HEAD";

  if (url.pathname === "/dashboard.css") {
    send(response, 200, "text/css; charset=utf-8", dashboardStyles, isHead);
    return;
  }
  if (url.pathname === "/dashboard.js") {
    send(response, 200, "text/javascript; charset=utf-8", dashboardScript, isHead);
    return;
  }

  if (url.pathname === "/api/project") {
    if (controller === undefined) {
      sendJson(response, 503, { error: "Dashboard execution is not configured" }, isHead);
      return;
    }
    sendJson(response, 200, { project: controller.manifest() }, isHead);
    return;
  }

  const executionId = routeParameter(url.pathname, "/api/executions/");
  if (executionId !== undefined) {
    const execution = controller?.get(executionId);
    if (execution === undefined) {
      sendJson(response, 404, { error: "Execution not found" }, isHead);
      return;
    }
    sendJson(response, 200, { execution }, isHead);
    return;
  }

  if (url.pathname === "/api/runs") {
    try {
      const page = await repository.query(runQueryFromUrl(url));
      sendJson(response, 200, {
        runs: page.runs.map(toRunSummary),
        ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
      }, isHead);
    } catch (error) {
      sendJson(response, 400, { error: errorMessage(error) }, isHead);
    }
    return;
  }

  if (url.pathname === "/api/compare") {
    const pair = await comparisonPair(repository, url);
    if ("error" in pair) {
      sendJson(response, pair.status, { error: pair.error }, isHead);
      return;
    }
    sendJson(response, 200, { comparison: compareRuns(pair.left, pair.right) }, isHead);
    return;
  }

  const apiRunId = routeParameter(url.pathname, "/api/runs/");
  if (apiRunId !== undefined) {
    const run = await repository.get(apiRunId);
    if (run === undefined) {
      sendJson(response, 404, { error: "Run not found" }, isHead);
      return;
    }
    sendJson(response, 200, { run }, isHead);
    return;
  }

  if (url.pathname === "/") {
    try {
      const page = await repository.query(runQueryFromUrl(url));
      sendHtml(
        response,
        200,
        renderRunList(page.runs, controller?.manifest(), url.searchParams),
        isHead,
      );
    } catch (error) {
      sendHtml(response, 400, page("Invalid filters", `<div class="error">${escapeHtml(errorMessage(error))}</div>`), isHead);
    }
    return;
  }

  if (url.pathname === "/compare") {
    const pair = await comparisonPair(repository, url);
    if ("error" in pair) {
      sendHtml(response, pair.status, page("Unable to compare", `<a class="back" href="/">← All runs</a><div class="error">${escapeHtml(pair.error)}</div>`), isHead);
      return;
    }
    sendHtml(response, 200, renderComparison(compareRuns(pair.left, pair.right)), isHead);
    return;
  }

  const dashboardRunId = routeParameter(url.pathname, "/runs/");
  if (dashboardRunId !== undefined) {
    const run = await repository.get(dashboardRunId);
    if (run === undefined) {
      sendHtml(response, 404, renderNotFound(), isHead);
      return;
    }
    sendHtml(response, 200, renderRunDetail(run), isHead);
    return;
  }

  sendHtml(response, 404, renderNotFound(), isHead);
}

function routeParameter(pathname: string, prefix: string): string | undefined {
  if (!pathname.startsWith(prefix)) return undefined;
  const encoded = pathname.slice(prefix.length);
  if (encoded.length === 0 || encoded.includes("/")) return undefined;
  try {
    const decoded = decodeURIComponent(encoded);
    return decoded.includes("/") ? undefined : decoded;
  } catch {
    return undefined;
  }
}

function toRunSummary(run: RunTrace): RunSummary {
  return {
    id: run.id,
    projectId: run.projectId,
    profileId: run.profileId,
    flowId: run.flowId,
    scenarioId: run.scenarioId,
    status: run.status,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    stepCount: run.steps.length,
    tags: [...run.tags],
    ...(run.sourceRunId === undefined ? {} : { sourceRunId: run.sourceRunId }),
  };
}

function renderRunList(
  runs: readonly RunTrace[],
  project?: DashboardProjectManifest,
  searchParams = new URLSearchParams(),
): string {
  const counts = {
    passed: runs.filter((run) => run.status === "passed").length,
    failed: runs.filter((run) => run.status === "failed").length,
    errored: runs.filter((run) => run.status === "errored").length,
  };
  const runRows = runs.length === 0
    ? `<div class="empty">No runs recorded yet. Execute a scenario to see its trace here.</div>`
    : runs.map((run) => `
      <a class="run" href="/runs/${encodeURIComponent(run.id)}">
        <strong>${escapeHtml(run.scenarioId)}${run.sourceRunId === undefined ? "" : " · reevaluation"}</strong>
        <span class="secondary muted">${escapeHtml(run.flowId)}</span>
        <span class="pill ${run.status}">${run.status}</span>
        <span class="secondary muted">${formatDuration(run.durationMs)}</span>
      </a>`).join("");
  const controls = project === undefined ? "" : renderExecutionControls(project);

  return page("Runs", `
    <header><div class="eyebrow">ai-testing-env</div><h1>Run evidence</h1>
      <p class="lede">Inspect backend and AI workflow traces from the local run repository. Every verdict links back to the captured steps and evaluations.</p></header>
    ${controls}${renderRunFilters(searchParams)}${renderCompareForm(runs)}<section class="summary" aria-label="Run summary">
      ${metric("Total", runs.length)}${metric("Passed", counts.passed)}${metric("Failed", counts.failed)}${metric("Errored", counts.errored)}
    </section>
    <section class="panel"><div class="panel-header"><h2>Recent runs</h2><span class="muted">Newest first</span></div><div class="run-list">${runRows}</div></section>
  `);
}

function renderRunFilters(searchParams: URLSearchParams): string {
  return `<form class="panel launch-form" method="get" action="/" aria-label="Filter Runs">
    <label>Project<input name="project" value="${escapeHtml(searchParams.get("project") ?? "")}"></label>
    <label>Flow<input name="flow" value="${escapeHtml(searchParams.get("flow") ?? "")}"></label>
    <label>Scenario<input name="scenario" value="${escapeHtml(searchParams.get("scenario") ?? "")}"></label>
    <label>Verdict<select name="verdict"><option value="">any</option>${["passed", "failed", "errored"].map((status) => `<option value="${status}"${searchParams.get("verdict") === status ? " selected" : ""}>${status}</option>`).join("")}</select></label>
    <label>Tag<input name="tag" value="${escapeHtml(searchParams.get("tag") ?? "")}"></label>
    <label>From<input type="datetime-local" name="from"></label><label>To<input type="datetime-local" name="to"></label><button type="submit">Filter</button>
  </form>`;
}

function renderCompareForm(runs: readonly RunTrace[]): string {
  if (runs.length < 2) return "";
  const options = runs.map((run) =>
    `<option value="${escapeHtml(run.id)}">${escapeHtml(run.id)} · ${escapeHtml(run.scenarioId)}</option>`
  ).join("");
  return `<form class="panel launch-form" method="get" action="/compare" aria-label="Compare Runs"><label>Before<select name="left">${options}</select></label><label>After<select name="right">${options}</select></label><button type="submit">Compare</button></form>`;
}

function renderComparison(comparison: ReturnType<typeof compareRuns>): string {
  return page("Run comparison", `<a class="back" href="/">← All runs</a><header><div class="eyebrow">${escapeHtml(comparison.leftRunId)} → ${escapeHtml(comparison.rightRunId)}</div><h1>Run comparison</h1><p class="lede">${comparison.compatible ? "Compatible Project, Flow, and Scenario." : "Warning: these Runs have different identities."}</p></header>
    <section class="panel step"><h3>Output</h3>${renderPayload("Change", comparison.output)}</section>
    <section class="panel step"><h3>Duration and tokens</h3><div class="payload-grid">${renderPayload("Duration", comparison.duration)}${renderPayload("Tokens", comparison.tokens)}</div></section>
    <section class="panel step"><h3>Steps</h3>${renderPayload("Changes", comparison.steps)}</section>
    <section class="panel step"><h3>Evaluations</h3>${renderPayload("Changes", comparison.evaluations)}</section>`);
}

function renderExecutionControls(project: DashboardProjectManifest): string {
  const scenarios = project.scenarios.map((scenario) =>
    `<option value="${escapeHtml(scenario.id)}">${escapeHtml(scenario.name)} · ${escapeHtml(scenario.flowId)}</option>`
  ).join("");
  const profiles = project.profiles.map((profile) => {
    const capabilities = Object.entries(profile.capabilities)
      .filter(([, allowed]) => allowed)
      .map(([name]) => name)
      .join(", ") || "none";
    const blocked = profile.projectAuthorized ? "" : " · blocked by Project";
    return `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.id)} · ${escapeHtml(capabilities)}${blocked}</option>`;
  }).join("");
  return `<section class="panel step" aria-label="Launch Scenario"><div class="panel-header"><h2>Launch Scenario</h2><span class="muted">Project ${escapeHtml(project.id)}</span></div>
    <form id="launch-run" class="launch-form"><label>Scenario<select name="scenarioId">${scenarios}</select></label><label>Profile<select name="profileId">${profiles}</select></label><label class="live-check"><input name="allowLive" type="checkbox"> Authorize live invocation</label><button type="submit">Run</button></form><div id="execution-status" class="execution-status muted">Ready</div></section>`;
}

function renderRunDetail(run: RunTrace): string {
  const steps = run.steps.length === 0
    ? `<div class="empty">This run did not record any steps.</div>`
    : run.steps.map(renderStep).join("");
  const runEvaluationBlock = run.evaluations.length === 0
    ? ""
    : `<section class="panel step"><h3>Run evaluations</h3>${renderEvaluations(run.evaluations)}</section>`;
  const errorBlock = run.error === undefined
    ? ""
    : `<div class="error"><strong>${escapeHtml(run.error.name)}</strong>: ${escapeHtml(run.error.message)}</div>`;
  const sourceBlock = run.sourceRunId === undefined
    ? ""
    : `<span>Reevaluates <a href="/runs/${encodeURIComponent(run.sourceRunId)}">${escapeHtml(run.sourceRunId)}</a></span>`;

  return page(run.scenarioId, `
    <a class="back" href="/">← All runs</a>
    <header class="detail-head"><div><div class="eyebrow">${escapeHtml(run.projectId)} / ${escapeHtml(run.flowId)} / ${escapeHtml(run.profileId)}</div><h1>${escapeHtml(run.scenarioId)}</h1></div><span class="pill ${run.status}">${run.status}</span></header>
    <div class="meta"><span>Run ${escapeHtml(run.id)}</span>${sourceBlock}<span>${escapeHtml(run.startedAt)}</span><span>${formatDuration(run.durationMs)}</span><span>${run.steps.length} steps</span></div>
    ${errorBlock}<section class="steps" aria-label="Trace steps">${steps}</section>${runEvaluationBlock}
  `);
}

function renderStep(step: StepTrace, index: number): string {
  const output = step.output === undefined ? "" : renderPayload("Output", step.output);
  const input = step.input === undefined ? "" : renderPayload("Input", step.input);
  const metadata = Object.keys(step.metadata).length === 0 ? "" : renderPayload("Metadata", step.metadata);
  const payloads = input + output + metadata;
  const error = step.error === undefined
    ? ""
    : `<div class="error"><strong>${escapeHtml(step.error.name)}</strong>: ${escapeHtml(step.error.message)}</div>`;

  return `<article class="panel step">
    <div class="step-head"><h3>${index + 1}. ${escapeHtml(step.name)} <span class="kind">${escapeHtml(step.kind)}</span></h3><span class="pill ${step.status}">${step.status}</span></div>
    <div class="meta"><span>${formatDuration(step.durationMs)}</span><span>${escapeHtml(step.startedAt)}</span></div>
    ${payloads.length === 0 ? "" : `<div class="payload-grid">${payloads}</div>`}${renderEvaluations(step.evaluations)}${error}
  </article>`;
}

function renderEvaluations(evaluations: readonly EvaluationResult[]): string {
  if (evaluations.length === 0) return "";
  return `<div class="evaluations">${evaluations.map((evaluation) => `
    <div class="evaluation"><span>${escapeHtml(evaluation.name)}${evaluation.message === undefined ? "" : ` — ${escapeHtml(evaluation.message)}`}</span><strong class="${evaluation.passed ? "passed" : "failed"}">${evaluation.passed ? "passed" : "failed"}</strong></div>`).join("")}</div>`;
}

function renderPayload(title: string, value: unknown): string {
  return `<div class="payload"><h4>${title}</h4><pre>${escapeHtml(formatJson(value))}</pre></div>`;
}

function renderNotFound(): string {
  return page("Not found", `<a class="back" href="/">← All runs</a><div class="panel empty"><h1>Run not found</h1><p>The requested trace is not present in this repository.</p></div>`);
}

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · ai-testing-env</title><link rel="stylesheet" href="/dashboard.css"></head><body><main class="shell">${content}</main><script src="/dashboard.js" defer></script></body></html>`;
}

function metric(label: string, value: number): string {
  return `<div class="metric"><span class="eyebrow">${label}</span><strong>${value}</strong></div>`;
}

function formatDuration(durationMs: number): string {
  return durationMs < 1_000 ? `${durationMs} ms` : `${(durationMs / 1_000).toFixed(2)} s`;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return "[Unserializable value]";
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function sendHtml(response: ServerResponse, status: number, body: string, headOnly: boolean): void {
  response.setHeader("content-security-policy", "default-src 'self'; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  send(response, status, "text/html; charset=utf-8", body, headOnly);
}

async function readExecutionRequest(
  request: IncomingMessage,
): Promise<{ scenarioId: string; profileId?: string; allowLive?: boolean }> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > 64 * 1024) throw new SyntaxError("Request body is too large");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new SyntaxError("Request body must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) {
    throw new SyntaxError("Request body must be an object");
  }
  const value = parsed as Record<string, unknown>;
  if (typeof value.scenarioId !== "string" || value.scenarioId.length === 0) {
    throw new SyntaxError("scenarioId must be a non-empty string");
  }
  if (value.profileId !== undefined && typeof value.profileId !== "string") {
    throw new SyntaxError("profileId must be a string");
  }
  if (value.allowLive !== undefined && typeof value.allowLive !== "boolean") {
    throw new SyntaxError("allowLive must be a boolean");
  }
  return {
    scenarioId: value.scenarioId,
    ...(value.profileId === undefined ? {} : { profileId: value.profileId }),
    ...(value.allowLive === undefined ? {} : { allowLive: value.allowLive }),
  };
}

function runQueryFromUrl(url: URL): RunQuery {
  const value = (name: string): string | undefined => {
    const entry = url.searchParams.get(name);
    return entry === null || entry.length === 0 ? undefined : entry;
  };
  const verdict = value("verdict");
  if (
    verdict !== undefined
    && verdict !== "passed"
    && verdict !== "failed"
    && verdict !== "errored"
  ) throw new Error(`Invalid Verdict: ${verdict}`);
  const limitValue = value("limit");
  const limit = limitValue === undefined ? undefined : Number(limitValue);
  if (limit !== undefined && !Number.isInteger(limit)) {
    throw new Error(`Invalid limit: ${limitValue}`);
  }
  const tags = url.searchParams.getAll("tag").filter((tag) => tag.length > 0);
  const projectId = value("project");
  const flowId = value("flow");
  const scenarioId = value("scenario");
  const startedFrom = value("from");
  const startedTo = value("to");
  const cursor = value("cursor");
  return {
    ...(projectId === undefined ? {} : { projectId }),
    ...(flowId === undefined ? {} : { flowId }),
    ...(scenarioId === undefined ? {} : { scenarioId }),
    ...(verdict === undefined ? {} : { status: verdict }),
    ...(tags.length === 0 ? {} : { tags }),
    ...(startedFrom === undefined ? {} : { startedFrom: normalizedDate("from", startedFrom) }),
    ...(startedTo === undefined ? {} : { startedTo: normalizedDate("to", startedTo) }),
    ...(cursor === undefined ? {} : { cursor }),
    ...(limit === undefined ? {} : { limit }),
  };
}

function normalizedDate(name: string, value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid ${name} date: ${value}`);
  return date.toISOString();
}

async function comparisonPair(
  repository: RunRepository,
  url: URL,
): Promise<
  | { left: RunTrace; right: RunTrace }
  | { status: 400 | 404; error: string }
> {
  const leftId = url.searchParams.get("left");
  const rightId = url.searchParams.get("right");
  if (!leftId || !rightId) {
    return { status: 400, error: "Select left and right Run ids" };
  }
  const [left, right] = await Promise.all([
    repository.get(leftId),
    repository.get(rightId),
  ]);
  if (left === undefined || right === undefined) {
    return { status: 404, error: "One or both Runs were not found" };
  }
  return { left, right };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sendJson(response: ServerResponse, status: number, value: unknown, headOnly = false): void {
  send(response, status, "application/json; charset=utf-8", `${JSON.stringify(value)}\n`, headOnly);
}

function send(response: ServerResponse, status: number, contentType: string, body: string, headOnly: boolean): void {
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.setHeader("x-content-type-options", "nosniff");
  response.end(headOnly ? undefined : body);
}

function formatHostForUrl(host: string): string {
  return host.includes(":") ? `[${host}]` : host;
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error === undefined ? resolve() : reject(error));
  });
}
