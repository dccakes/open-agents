import { postureSchema as agentPostureSchema } from "@open-agents/agent";
import { describe, expect, test } from "bun:test";
import { getTableColumns } from "drizzle-orm";
import type { z } from "zod";
import { sessions } from "@/lib/db/schema";
import {
  DEFAULT_POSTURE,
  isPosture,
  type Posture,
  POSTURES,
  postureSchema,
} from "@/lib/policy/posture";

describe("posture vocabulary", () => {
  test("is exactly strict, auto, and dangerous", () => {
    expect(POSTURES).toEqual(["strict", "auto", "dangerous"]);
    expect(postureSchema.options).toEqual(["strict", "auto", "dangerous"]);
  });

  test("defaults to auto, which is what every session did before postures", () => {
    expect(DEFAULT_POSTURE).toBe("auto");
  });

  /**
   * The posture is declared three times: here, on the `sessions.posture`
   * column, and in `packages/agent/policy/types.ts` where it is evaluated. All
   * three must agree or a stored posture becomes unevaluatable.
   *
   * The web app's copy is a redeclaration rather than a re-export on purpose:
   * `@open-agents/agent`'s package root pulls the AI SDK runtime in with it,
   * and these modules are reachable from workflow code, where that import is
   * known to break (see `app/api/chat/_lib/persist-tool-results.ts`). The
   * assertion below buys the guarantee without the runtime dependency, because
   * test files are never bundled.
   */
  test("matches the sessions.posture column exactly", () => {
    expect(getTableColumns(sessions).posture.enumValues).toEqual([...POSTURES]);
  });

  test("matches the posture the agent package evaluates", () => {
    expect(agentPostureSchema.options).toEqual([...POSTURES]);

    // Assignable both ways, so neither side can add a value the other cannot
    // represent without failing typecheck.
    const fromAgent: Posture = "dangerous" satisfies z.infer<
      typeof agentPostureSchema
    >;
    const toAgent: z.infer<typeof agentPostureSchema> =
      "strict" satisfies Posture;

    expect([fromAgent, toAgent]).toEqual(["dangerous", "strict"]);
  });

  test("rejects anything else", () => {
    expect(postureSchema.safeParse("yolo").success).toBe(false);
    expect(postureSchema.safeParse("").success).toBe(false);
    expect(postureSchema.safeParse(undefined).success).toBe(false);
  });
});

describe("isPosture", () => {
  test("narrows a valid posture", () => {
    expect(isPosture("strict")).toBe(true);
    expect(isPosture("auto")).toBe(true);
    expect(isPosture("dangerous")).toBe(true);
  });

  test("refuses anything else without throwing", () => {
    expect(isPosture("DANGEROUS")).toBe(false);
    expect(isPosture(null)).toBe(false);
    expect(isPosture(3)).toBe(false);
  });
});
