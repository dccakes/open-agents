import type { SandboxProviderDef } from "../../provider";
import { defaultRegistry } from "../../registry";
import { DockerSandbox } from "./sandbox";
import type { DockerState } from "./state";

export const dockerProvider: SandboxProviderDef<DockerState> = {
  type: "docker",
  label: "Docker",
  capabilities: {
    persistent: false,
    db: true,
    envInjection: true,
    credentialBrokering: false,
  },
  isAvailable: () => process.env.NODE_ENV === "development",
  reasonUnavailable: () =>
    process.env.NODE_ENV !== "development"
      ? "Docker sandbox is only available in local development"
      : undefined,
  create: (state, options) => DockerSandbox.create(state, options),
  connect: (state, options) =>
    state.containerId
      ? DockerSandbox.connect(state, options)
      : DockerSandbox.create(state, options),
};

defaultRegistry.register(dockerProvider);
