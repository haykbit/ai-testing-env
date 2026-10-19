import type {
  ExecutionProfile,
  ProjectDefinition,
  ResourceCapability,
} from "./types.js";

export const builtInProfiles: readonly ExecutionProfile[] = [
  {
    id: "mocked",
    mode: "mocked",
    capabilities: { network: false, write: false, spend: false },
  },
  {
    id: "recorded",
    mode: "recorded",
    capabilities: { network: false, write: false, spend: false },
  },
  {
    id: "integration",
    mode: "integration",
    capabilities: { network: true, write: false, spend: false },
  },
  {
    id: "live",
    mode: "live",
    capabilities: { network: true, write: true, spend: true },
  },
];

export const defaultExecutionProfile = builtInProfiles[0]!;

export function defineProfile(profile: ExecutionProfile): ExecutionProfile {
  if (typeof profile.id !== "string" || profile.id.length === 0) {
    throw new Error("Profile id must be a non-empty string");
  }
  if (
    profile.mode !== "mocked"
    && profile.mode !== "recorded"
    && profile.mode !== "integration"
    && profile.mode !== "live"
  ) {
    throw new Error(`Invalid Profile mode: ${String(profile.mode)}`);
  }
  for (const capability of ["network", "write", "spend"] as const) {
    if (typeof profile.capabilities?.[capability] !== "boolean") {
      throw new Error(
        `Profile ${profile.id} must define boolean capability ${capability}`,
      );
    }
  }
  return profile;
}

export function resolveExecutionProfile(
  project: ProjectDefinition,
  profileId = defaultExecutionProfile.id,
): ExecutionProfile {
  const profile = [...builtInProfiles, ...(project.profiles ?? [])].find(
    (candidate) => candidate.id === profileId,
  );
  if (profile === undefined) {
    throw new Error(`Unknown Profile: ${profileId}`);
  }
  if (profile.mode === "live" && project.allowLive !== true) {
    throw new LiveExecutionAuthorizationError(
      `Project ${project.id} does not allow live execution; set allowLive: true in its configuration`,
    );
  }
  return profile;
}

export function assertLiveExecutionAuthorized(
  profile: ExecutionProfile,
  capabilities: readonly ResourceCapability[],
  allowLive: boolean,
): void {
  if (profile.mode === "live" && capabilities.length > 0 && !allowLive) {
    throw new LiveExecutionAuthorizationError(
      "Live execution requires explicit invocation authorization; pass --allow-live",
    );
  }
}

export function assertCapabilitiesAllowed(
  profile: ExecutionProfile,
  capabilities: readonly ResourceCapability[],
): void {
  const denied = capabilities.filter(
    (capability) => !profile.capabilities[capability],
  );
  if (denied.length > 0) {
    throw new ProfilePolicyError(profile.id, denied);
  }
}

export class ProfilePolicyError extends Error {
  readonly profileId: string;
  readonly deniedCapabilities: readonly ResourceCapability[];

  constructor(
    profileId: string,
    deniedCapabilities: readonly ResourceCapability[],
  ) {
    super(
      `Profile ${profileId} does not allow: ${deniedCapabilities.join(", ")}`,
    );
    this.name = "ProfilePolicyError";
    this.profileId = profileId;
    this.deniedCapabilities = deniedCapabilities;
  }
}

export class LiveExecutionAuthorizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveExecutionAuthorizationError";
  }
}
