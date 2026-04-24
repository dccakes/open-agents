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
  isAvailable: () => true,
  reasonUnavailable: () => undefined,
  create: (state, options) => DockerSandbox.create(state, options),
  connect: (state, options) => DockerSandbox.connect(state, options),
};

defaultRegistry.register(dockerProvider);
