import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import type {
  EvaluationResult,
  RunRepository,
  RunTrace,
  StepTrace,
  Verdict,
} from "@ai-testing-env/core";

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
@media (max-width: 760px) { .summary { grid-template-columns: repeat(2, 1fr); } .run { grid-template-columns: minmax(0, 1fr) auto; } .run .secondary { display: none; } .detail-head { display: grid; } .payload-grid { grid-template-columns: 1fr; } }
`;

export interface DashboardServerOptions {
  repository: RunRepository;
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

export function createDashboardRequestListener(repository: RunRepository): RequestListener {
  return (request, response) => {
    void routeRequest(repository, request, response).catch((error: unknown) => {
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
  const server = createDashboardServer(options.repository);

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
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("allow", "GET, HEAD");
    sendJson(response, 405, { error: "Method not allowed" }, request.method === "HEAD");
    return;
  }

  const url = new URL(request.url ?? "/", "http://localhost");
  const isHead = request.method === "HEAD";

  if (url.pathname === "/dashboard.css") {
    send(response, 200, "text/css; charset=utf-8", dashboardStyles, isHead);
    return;
  }

  if (url.pathname === "/api/runs") {
    const runs = await repository.list();
    sendJson(response, 200, { runs: runs.map(toRunSummary) }, isHead);
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
    const runs = await repository.list();
    sendHtml(response, 200, renderRunList(runs), isHead);
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

function renderRunList(runs: readonly RunTrace[]): string {
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

  return page("Runs", `
    <header><div class="eyebrow">ai-testing-env</div><h1>Run evidence</h1>
      <p class="lede">Inspect backend and AI workflow traces from the local run repository. Every verdict links back to the captured steps and evaluations.</p></header>
    <section class="summary" aria-label="Run summary">
      ${metric("Total", runs.length)}${metric("Passed", counts.passed)}${metric("Failed", counts.failed)}${metric("Errored", counts.errored)}
    </section>
    <section class="panel"><div class="panel-header"><h2>Recent runs</h2><span class="muted">Newest first</span></div><div class="run-list">${runRows}</div></section>
  `);
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
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} · ai-testing-env</title><link rel="stylesheet" href="/dashboard.css"></head><body><main class="shell">${content}</main></body></html>`;
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
  response.setHeader("content-security-policy", "default-src 'self'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  send(response, status, "text/html; charset=utf-8", body, headOnly);
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
