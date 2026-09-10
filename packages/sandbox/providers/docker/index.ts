import { getDockerProviderConfig } from "../../config";
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
  configFields: [
    {
      key: "DOCKER_SANDBOX_IMAGE",
      label: "Sandbox Image",
      type: "text",
      required: true,
      placeholder: "open-agents/sandbox-dev:latest",
    },
  ],
  isAvailable: () => getDockerProviderConfig().isDevelopment,
  reasonUnavailable: () =>
    getDockerProviderConfig().isDevelopment
      ? undefined
      : "Docker sandbox is only available in local development",
  create: (state, options) => DockerSandbox.create(state, options),
  connect: (state, options) =>
    state.containerId
      ? DockerSandbox.connect(state, options)
      : DockerSandbox.create(state, options),
};

defaultRegistry.register(dockerProvider);
