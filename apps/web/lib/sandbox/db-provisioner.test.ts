import { describe, expect, test } from "bun:test";

describe("getDbProvisioner", () => {
  test("returns NeonProvisioner for vercel provider", async () => {
    const { getDbProvisioner } = await import("./db-provisioner");
    const provisioner = getDbProvisioner("vercel");
    expect(provisioner?.constructor.name).toBe("NeonProvisioner");
  });

  test("returns NeonProvisioner for daytona provider", async () => {
    const { getDbProvisioner } = await import("./db-provisioner");
    const provisioner = getDbProvisioner("daytona");
    expect(provisioner?.constructor.name).toBe("NeonProvisioner");
  });

  test("returns DockerPostgresProvisioner for docker provider", async () => {
    const { getDbProvisioner } = await import("./db-provisioner");
    const provisioner = getDbProvisioner("docker");
    expect(provisioner?.constructor.name).toBe("DockerPostgresProvisioner");
  });
});
