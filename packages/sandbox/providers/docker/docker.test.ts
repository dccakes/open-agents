import { describe, expect, test } from "bun:test";
import { defaultRegistry } from "../../registry";
import { dockerProvider } from "./index";

const dockerfilePath = new URL("Dockerfile", import.meta.url);

describe("Docker provider", () => {
  test("registers in defaultRegistry", () => {
    const def = defaultRegistry.get("docker");
    expect(def).toBe(dockerProvider);
  });

  test("capabilities are set correctly", () => {
    expect(dockerProvider.capabilities.persistent).toBe(false);
    expect(dockerProvider.capabilities.db).toBe(true);
    expect(dockerProvider.capabilities.envInjection).toBe(true);
    expect(dockerProvider.capabilities.credentialBrokering).toBe(false);
  });

  test("Dockerfile installs Chromium through apt on Linux ARM64", async () => {
    const dockerfile = await Bun.file(dockerfilePath).text();

    expect(dockerfile).toContain("ARG TARGETARCH");
    expect(dockerfile).toContain("chromium");
    expect(dockerfile).toContain(
      "agent-browser --executable-path /usr/bin/chromium",
    );
    expect(dockerfile).toContain(
      "https://raw.githubusercontent.com/rtk-ai/rtk/master/install.sh",
    );
    expect(dockerfile).toContain("RTK_INSTALL_DIR=/usr/local/bin");
    expect(dockerfile).toContain(
      "cargo install --git https://github.com/rtk-ai/rtk --locked --root /usr/local --force",
    );
    expect(dockerfile).toContain("https://sh.rustup.rs");
    expect(dockerfile).not.toContain("&& bunx agent-browser install chromium");
  });
});
