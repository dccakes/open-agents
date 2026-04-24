import { beforeEach, describe, expect, mock, test } from "bun:test";
import { connectSandbox } from "./factory";
import type { Sandbox } from "./interface";
import type { SandboxProviderDef } from "./provider";
import { defaultRegistry, SandboxRegistry } from "./registry";

function makeConnectedSandbox(label: string): Sandbox {
  return {
    type: "vercel",
    workingDirectory: "/",
    readFile: async () => label,
  } as unknown as Sandbox;
}

function clearDefaultRegistry(): void {
  const registry = defaultRegistry as unknown as {
    providers: Map<string, SandboxProviderDef>;
  };
  registry.providers.clear();
}

function makeDef(
  type: "vercel" | "docker",
  connectMock: ReturnType<typeof mock>,
): SandboxProviderDef {
  return {
    type,
    label: type,
    capabilities: {
      persistent: false,
      db: false,
      envInjection: false,
      credentialBrokering: false,
    },
    isAvailable: () => true,
    reasonUnavailable: () => undefined,
    create: connectMock,
    connect: connectMock,
  };
}

describe("legacy cloud-session compatibility", () => {
  beforeEach(() => {
    clearDefaultRegistry();
  });

  test("session state persisted with type cloud reconnects through vercel provider in registry", async () => {
    const registry = new SandboxRegistry();
    const vercelConnectMock = mock(async () =>
      makeConnectedSandbox("vercel-connected"),
    );
    const dockerConnectMock = mock(async () =>
      makeConnectedSandbox("docker-connected"),
    );

    registry.register(makeDef("vercel", vercelConnectMock));
    registry.register(makeDef("docker", dockerConnectMock));

    const legacyCloudSessionState = {
      type: "cloud" as const,
      sandboxName: "session_123",
      sandboxId: "runtime_legacy_123",
      expiresAt: Date.now() + 300_000,
    };
    const options = { resume: true };

    await registry.connect(legacyCloudSessionState as never, options);

    expect(vercelConnectMock).toHaveBeenCalledTimes(1);
    expect(vercelConnectMock).toHaveBeenCalledWith(
      legacyCloudSessionState,
      options,
    );
    expect(dockerConnectMock).not.toHaveBeenCalled();
  });

  test("factory path accepts legacy cloud state and dispatches correctly", async () => {
    const connectMock = mock(async () =>
      makeConnectedSandbox("vercel-connected"),
    );
    defaultRegistry.register(makeDef("vercel", connectMock));

    const legacyCloudSessionState = {
      type: "cloud" as const,
      sandboxName: "session_456",
      sandboxId: "runtime_legacy_456",
      expiresAt: Date.now() + 300_000,
    };
    const options = { resume: true, timeout: 120_000 };

    await connectSandbox(legacyCloudSessionState, options);

    expect(connectMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledWith(legacyCloudSessionState, options);
  });
});
