import { describe, expect, test } from "bun:test";
import {
  BASE_BOTID_ALLOWED_HOSTS,
  parseExtraAllowedHosts,
  resolveBotIdAllowedHosts,
} from "./botid-allowed-hosts";

describe("parseExtraAllowedHosts", () => {
  test("returns an empty list when unset or blank", () => {
    expect(parseExtraAllowedHosts(undefined)).toEqual([]);
    expect(parseExtraAllowedHosts("  , ,")).toEqual([]);
  });

  test("trims, lowercases, and de-duplicates entries", () => {
    expect(
      parseExtraAllowedHosts(
        " App.Example.com, *.example.com ,app.example.com",
      ),
    ).toEqual(["app.example.com", "*.example.com"]);
  });
});

describe("resolveBotIdAllowedHosts", () => {
  test("keeps the base hosts when no override is configured", () => {
    expect(resolveBotIdAllowedHosts(undefined)).toEqual([
      ...BASE_BOTID_ALLOWED_HOSTS,
    ]);
  });

  test("appends configured hosts without duplicating base entries", () => {
    expect(resolveBotIdAllowedHosts("vercel.com,app.example.com")).toEqual([
      ...BASE_BOTID_ALLOWED_HOSTS,
      "app.example.com",
    ]);
  });
});
