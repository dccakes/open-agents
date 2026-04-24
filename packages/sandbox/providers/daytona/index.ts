import type { SandboxProviderDef } from "../../provider";
import { defaultRegistry } from "../../registry";
import { DaytonaSandbox } from "./sandbox";
import type { DaytonaState } from "./state";

function isDaytonaAvailable(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY && process.env.DAYTONA_SERVER_URL);
}

function getDaytonaUnavailableReason(): string | undefined {
  if (!process.env.DAYTONA_API_KEY) {
    return "DAYTONA_API_KEY environment variable is not set";
  }
  if (!process.env.DAYTONA_SERVER_URL) {
    return "DAYTONA_SERVER_URL environment variable is not set";
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
  connect: (state, options) => DaytonaSandbox.connect(state, options),
};

defaultRegistry.register(daytonaProvider);
