import { getDaytonaProviderConfig } from "../../config";
import type { SandboxProviderDef } from "../../provider";
import { defaultRegistry } from "../../registry";
import { DaytonaSandbox } from "./sandbox";
import type { DaytonaState } from "./state";

function isDaytonaAvailable(): boolean {
  return getDaytonaProviderConfig().betaEnabled;
}

function getDaytonaUnavailableReason(): string | undefined {
  if (!getDaytonaProviderConfig().betaEnabled) {
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
  configFields: [
    {
      key: "DAYTONA_SERVER_URL",
      label: "Server URL",
      type: "url",
      required: true,
      placeholder: "https://app.daytona.io",
    },
    {
      key: "DAYTONA_API_KEY",
      label: "API Key",
      type: "password",
      required: true,
    },
  ],
  isAvailable: isDaytonaAvailable,
  reasonUnavailable: getDaytonaUnavailableReason,
  create: (state, options) => DaytonaSandbox.create(state, options),
  connect: (state, options) =>
    state.workspaceId
      ? DaytonaSandbox.connect(state, options)
      : DaytonaSandbox.create(state, options),
};

defaultRegistry.register(daytonaProvider);
