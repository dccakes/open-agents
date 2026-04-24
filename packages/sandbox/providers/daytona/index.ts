import type { SandboxProviderDef } from "../../provider";
import { defaultRegistry } from "../../registry";
import { DaytonaSandbox } from "./sandbox";
import type { DaytonaState } from "./state";

function isDaytonaAvailable(): boolean {
  const betaFlag = process.env.DAYTONA_BETA_ENABLED;
  const betaEnabled = betaFlag === "true" || betaFlag === "1";
  return Boolean(
    process.env.DAYTONA_API_KEY &&
    process.env.DAYTONA_SERVER_URL &&
    betaEnabled,
  );
}

function getDaytonaUnavailableReason(): string | undefined {
  if (!process.env.DAYTONA_API_KEY) {
    return "DAYTONA_API_KEY environment variable is not set";
  }
  if (!process.env.DAYTONA_SERVER_URL) {
    return "DAYTONA_SERVER_URL environment variable is not set";
  }
  if (
    process.env.DAYTONA_BETA_ENABLED !== "true" &&
    process.env.DAYTONA_BETA_ENABLED !== "1"
  ) {
    return "DAYTONA_BETA_ENABLED environment variable must be set to true or 1";
  }
  return undefined;
}

export const daytonaProvider: SandboxProviderDef<DaytonaState> = {
  type: "daytona",
  label: "Daytona (Beta)",
  beta: true,
  capabilities: {
    persistent: true,
    db: true,
    envInjection: true,
    credentialBrokering: true,
  },
  isAvailable: isDaytonaAvailable,
  reasonUnavailable: getDaytonaUnavailableReason,
  create: (state, options) => DaytonaSandbox.create(state, options),
  connect: (state, options) =>
    state.workspaceId
      ? DaytonaSandbox.connect(state, options)
      : DaytonaSandbox.create(state, options),
};

defaultRegistry.register(daytonaProvider);
