import { describe, expect, test } from "bun:test";
import {
  type LinearActorLookup,
  resolveLinearActorIdentity,
} from "@/lib/linear/actor-resolution";

const NOTHING_FOUND: LinearActorLookup = {
  mappedUserId: null,
  emailMatch: null,
};

describe("resolveLinearActorIdentity", () => {
  test("resolves a verified email match", () => {
    expect(
      resolveLinearActorIdentity(
        { email: "ada@nextdegree.org" },
        {
          mappedUserId: null,
          emailMatch: { userId: "u1", emailVerified: true },
        },
      ),
    ).toEqual({ ok: true, userId: "u1", via: "verified-email" });
  });

  test("refuses an unverified email match", () => {
    expect(
      resolveLinearActorIdentity(
        { email: "ada@nextdegree.org" },
        {
          mappedUserId: null,
          emailMatch: { userId: "u1", emailVerified: false },
        },
      ),
    ).toEqual({ ok: false, reason: "unverified-email", userId: "u1" });
  });

  test("resolves an explicitly mapped Linear identity", () => {
    expect(
      resolveLinearActorIdentity(
        { linearUserId: "lin_1", email: "personal@example.com" },
        { mappedUserId: "u7", emailMatch: null },
      ),
    ).toEqual({ ok: true, userId: "u7", via: "mapping" });
  });

  test("the mapping wins over a conflicting email match", () => {
    expect(
      resolveLinearActorIdentity(
        { linearUserId: "lin_1", email: "ada@nextdegree.org" },
        {
          mappedUserId: "u7",
          emailMatch: { userId: "u1", emailVerified: true },
        },
      ),
    ).toEqual({ ok: true, userId: "u7", via: "mapping" });
  });

  test("a mapping resolves an actor whose address matches nobody", () => {
    expect(
      resolveLinearActorIdentity(
        { linearUserId: "lin_1", email: "contractor@elsewhere.com" },
        { mappedUserId: "u7", emailMatch: null },
      ).ok,
    ).toBe(true);
  });

  test("refuses an actor carrying no identity at all", () => {
    expect(resolveLinearActorIdentity({}, NOTHING_FOUND)).toEqual({
      ok: false,
      reason: "no-identity",
    });
  });

  test("refuses an actor nobody is mapped to and whose address matches nobody", () => {
    expect(
      resolveLinearActorIdentity(
        { linearUserId: "lin_9", email: "stranger@example.com" },
        NOTHING_FOUND,
      ),
    ).toEqual({ ok: false, reason: "not-connected" });
  });

  test("never falls back to a default identity", () => {
    const outcomes = [
      resolveLinearActorIdentity({}, NOTHING_FOUND),
      resolveLinearActorIdentity({ email: "x@y.z" }, NOTHING_FOUND),
      resolveLinearActorIdentity({ linearUserId: "lin_1" }, NOTHING_FOUND),
    ];

    expect(outcomes.every((outcome) => outcome.ok === false)).toBe(true);
  });

  test("distinguishes unresolved from unverified so callers can tell them apart", () => {
    const unresolved = resolveLinearActorIdentity(
      { email: "stranger@example.com" },
      NOTHING_FOUND,
    );
    const unverified = resolveLinearActorIdentity(
      { email: "ada@nextdegree.org" },
      {
        mappedUserId: null,
        emailMatch: { userId: "u1", emailVerified: false },
      },
    );

    expect(unresolved.ok === false && unresolved.reason).toBe("not-connected");
    expect(unverified.ok === false && unverified.reason).toBe(
      "unverified-email",
    );
  });
});
