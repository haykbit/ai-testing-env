import { randomUUID } from "node:crypto";
import {
  builtInProfiles,
  redactValue,
  resolveExecutionProfile,
  type ExecutionProfile,
  type ProjectDefinition,
  type RunRepository,
  type RunTrace,
  type Verdict,
} from "@ai-testing-env/core";
import { runProjectScenario } from "ai-testing-env";

export type ExecutionStatus = "pending" | "running" | "completed" | "failed";

export interface DashboardExecution {
  id: string;
  runId: string;
  scenarioId: string;
  profileId: string;
  allowLive: boolean;
  status: ExecutionStatus;
  verdict?: Verdict;
  error?: string;
}

export interface CreateDashboardExecution {
  scenarioId: string;
  profileId?: string;
  allowLive?: boolean;
}

export interface DashboardProjectManifest {
  id: string;
  allowLive: boolean;
  flows: Array<{ id: string; name: string }>;
  scenarios: Array<{
    id: string;
    name: string;
    flowId: string;
    defaultProfileId: string;
  }>;
  profiles: Array<ExecutionProfile & {
    requiresInvocationAuthorization: boolean;
    projectAuthorized: boolean;
  }>;
}

export interface DashboardExecutionOptions {
  project: ProjectDefinition;
  repository: RunRepository;
  execute?: (
    scenarioId: string,
    options: { runId: string; profileId: string; allowLive: boolean },
  ) => Promise<RunTrace>;
}

export class DashboardExecutionController {
  private readonly jobs = new Map<string, DashboardExecution>();
  private readonly activeScenarios = new Set<string>();
  private readonly execute;

  constructor(private readonly options: DashboardExecutionOptions) {
    this.execute = options.execute ?? ((scenarioId, executionOptions) =>
      runProjectScenario(options.project, scenarioId, {
        repository: options.repository,
        runId: executionOptions.runId,
        profileId: executionOptions.profileId,
        allowLive: executionOptions.allowLive,
      }));
  }

  manifest(): DashboardProjectManifest {
    const customProfiles = this.options.project.profiles ?? [];
    return {
      id: this.options.project.id,
      allowLive: this.options.project.allowLive === true,
      flows: this.options.project.flows.map((flow) => ({
        id: flow.id,
        name: flow.name ?? flow.id,
      })),
      scenarios: this.options.project.scenarios.map((scenario) => ({
        id: scenario.id,
        name: scenario.name ?? scenario.id,
        flowId: scenario.flowId,
        defaultProfileId: scenario.profileId ?? "mocked",
      })),
      profiles: [...builtInProfiles, ...customProfiles].map((profile) => ({
        ...profile,
        requiresInvocationAuthorization: profile.mode === "live",
        projectAuthorized: profile.mode !== "live"
          || this.options.project.allowLive === true,
      })),
    };
  }

  create(request: CreateDashboardExecution): DashboardExecution {
    const scenario = this.options.project.scenarios.find(
      (candidate) => candidate.id === request.scenarioId,
    );
    if (scenario === undefined) {
      throw new DashboardExecutionRequestError(
        400,
        `Unknown Scenario: ${request.scenarioId}`,
      );
    }
    const profileId = request.profileId ?? scenario.profileId ?? "mocked";
    try {
      resolveExecutionProfile(this.options.project, profileId);
    } catch (error) {
      throw new DashboardExecutionRequestError(400, errorMessage(error));
    }
    if (this.activeScenarios.has(scenario.id)) {
      throw new DashboardExecutionRequestError(
        409,
        `Scenario ${scenario.id} already has an active execution`,
      );
    }

    const job: DashboardExecution = {
      id: randomUUID(),
      runId: `run-${randomUUID()}`,
      scenarioId: scenario.id,
      profileId,
      allowLive: request.allowLive === true,
      status: "pending",
    };
    this.jobs.set(job.id, job);
    this.activeScenarios.add(scenario.id);
    queueMicrotask(() => void this.run(job));
    return { ...job };
  }

  get(id: string): DashboardExecution | undefined {
    const job = this.jobs.get(id);
    return job === undefined ? undefined : { ...job };
  }

  private async run(job: DashboardExecution): Promise<void> {
    job.status = "running";
    try {
      const run = await this.execute(job.scenarioId, {
        runId: job.runId,
        profileId: job.profileId,
        allowLive: job.allowLive,
      });
      job.status = "completed";
      job.verdict = run.status;
    } catch (error) {
      job.status = "failed";
      job.error = redactValue(errorMessage(error), this.options.project.redaction);
    } finally {
      this.activeScenarios.delete(job.scenarioId);
    }
  }
}

export class DashboardExecutionRequestError extends Error {
  constructor(readonly status: 400 | 409, message: string) {
    super(message);
    this.name = "DashboardExecutionRequestError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
