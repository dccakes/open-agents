import { expect, mock, test } from "bun:test";

const connect = mock(async () => ({
  workingDirectory: "/vercel/sandbox",
  snapshot: async () => ({ snapshotId: "snap-built" }),
  stop: async () => {},
}));

mock.module("./connect", () => ({ connectVercel: connect }));

const { refreshBaseSnapshot } = await import("./snapshot-refresh");

test("standalone refresh starts from the standard runtime without provider registration", async () => {
  const result = await refreshBaseSnapshot({ sandboxTimeoutMs: 300_000 });

  expect(connect).toHaveBeenCalledWith(
    {},
    {
      baseSnapshotId: undefined,
      timeout: 300_000,
      persistent: false,
      skipGitWorkspaceBootstrap: true,
    },
  );
  expect(result.snapshotId).toBe("snap-built");
  expect(result.sourceSnapshotId).toBeUndefined();
});
