import { describe, expect, test } from "bun:test";
import { optionalDomainList, optionalEmailList } from "@/lib/config/schemas";

describe("optionalDomainList", () => {
  test("splits, trims, and lowercases a comma-separated list", () => {
    expect(optionalDomainList.parse(" NextDegree.org , Example.COM ")).toEqual([
      "nextdegree.org",
      "example.com",
    ]);
  });

  test("strips a leading @ so `@example.com` and `example.com` agree", () => {
    expect(optionalDomainList.parse("@example.com")).toEqual(["example.com"]);
  });

  test("drops blank entries and duplicates", () => {
    expect(optionalDomainList.parse("a.com,,b.com, A.com ,")).toEqual([
      "a.com",
      "b.com",
    ]);
  });

  test("is undefined when unset, so nothing auto-approves", () => {
    expect(optionalDomainList.parse(undefined)).toBeUndefined();
  });

  test("is undefined when blank or whitespace-only", () => {
    expect(optionalDomainList.parse("")).toBeUndefined();
    expect(optionalDomainList.parse("  ,  , ")).toBeUndefined();
  });
});

describe("optionalEmailList", () => {
  test("splits, trims, and lowercases a comma-separated list", () => {
    expect(
      optionalEmailList.parse("Ada@Example.com, grace@example.com"),
    ).toEqual(["ada@example.com", "grace@example.com"]);
  });

  test("drops blank entries and duplicates", () => {
    expect(optionalEmailList.parse("a@x.com,,a@X.com, b@x.com ")).toEqual([
      "a@x.com",
      "b@x.com",
    ]);
  });

  test("is undefined when unset", () => {
    expect(optionalEmailList.parse(undefined)).toBeUndefined();
  });

  test("is undefined when blank, so presence checks see it as missing", () => {
    expect(optionalEmailList.parse("   ")).toBeUndefined();
  });
});
