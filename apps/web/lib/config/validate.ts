/**
 * Boot-time validation of the full server config surface.
 *
 * Called from `instrumentation.ts` so a deployment missing a required variable
 * fails at startup — naming the variable — instead of at the first request that
 * happens to need it.
 *
 * Enforcement is per environment axis and only bites on a *production*
 * deployment: previews legitimately run without the optional integrations.
 */

import { isProductionDeployment } from "@/lib/config/deployment";
import { configGroups } from "@/lib/config/registry";

export interface ConfigValidationResult {
  errors: string[];
  warnings: string[];
}

type PresenceMap = Map<string, boolean>;

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  return typeof value === "string" ? value.length > 0 : true;
}

function collectPresence(errors: string[]): PresenceMap {
  const presence: PresenceMap = new Map();

  for (const group of configGroups) {
    let values: Record<string, unknown>;
    try {
      values = group.read() as Record<string, unknown>;
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
      continue;
    }

    for (const [name, value] of Object.entries(values)) {
      presence.set(name, isPresent(value));
    }
  }

  return presence;
}

function isRequiredInProduction(
  name: string,
  presence: PresenceMap,
  requiredWith: readonly string[] | undefined,
  axis: string,
): boolean {
  if (axis === "required-prod") {
    return true;
  }

  if (!requiredWith || requiredWith.length === 0) {
    return false;
  }

  return requiredWith.every((dependency) => presence.get(dependency) === true);
}

/** Collect config problems without throwing, so callers can report them all. */
export function collectConfigProblems(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const presence = collectPresence(errors);
  const production = isProductionDeployment();

  for (const group of configGroups) {
    for (const [name, spec] of Object.entries(group.specs)) {
      const present = presence.get(name) === true;

      if (present) {
        if (spec.axis === "dev-only" && production) {
          warnings.push(
            `${name} is set in production but only applies to local development.`,
          );
        }
        continue;
      }

      if (!production) {
        continue;
      }

      if (
        isRequiredInProduction(name, presence, spec.requiredWith, spec.axis)
      ) {
        const reason =
          spec.axis === "required-prod"
            ? "required in production"
            : `required in production because ${spec.requiredWith?.join(", ")} is set`;
        errors.push(`${name} is ${reason}. ${spec.description}`);
      }
    }
  }

  return { errors, warnings };
}

/**
 * Validate the server config, throwing on the first failing environment.
 *
 * @throws when a production deployment is missing a required variable, or any
 * group fails to parse.
 */
export function validateServerConfig(): void {
  const { errors, warnings } = collectConfigProblems();

  for (const warning of warnings) {
    console.warn(`[config] ${warning}`);
  }

  if (errors.length === 0) {
    return;
  }

  throw new Error(
    `Invalid environment configuration:\n${errors.map((error) => `  - ${error}`).join("\n")}`,
  );
}
