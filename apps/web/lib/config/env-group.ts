/**
 * Declarative environment-variable groups.
 *
 * A group is the unit of lazy validation: one Zod object per concern, parsed on
 * every read so tests (and long-lived server processes) observe environment
 * changes. Each variable also declares an *environment axis* so boot validation
 * can decide what a production deploy must have without a second, hand-written
 * "required" list.
 */

import { z } from "zod";
import { type RawEnv, readServerEnv } from "@/lib/config/env-source";

/**
 * When a variable must be present.
 *
 * - `required-prod`: a production boot without it is broken; fails validation.
 * - `optional`: feature-gated or has a working default.
 * - `dev-only`: only meaningful in local development.
 */
export type EnvAxis = "required-prod" | "optional" | "dev-only";

export interface EnvVarSpec<Schema extends z.ZodType = z.ZodType> {
  /** Environment axis enforced by `validateServerConfig()`. */
  axis: EnvAxis;
  /** One-line description, reused verbatim in `.env.example`. */
  description: string;
  /** Validation applied to the raw string value. */
  schema: Schema;
  /** Secrets are emitted blank in `.env.example`. */
  secret?: boolean;
  /** Example value for `.env.example` (non-secrets only). */
  example?: string;
  /**
   * Promotes an `optional` variable to production-required when every listed
   * variable is also set. Models integrations that are all-or-nothing: a
   * half-configured Linear app fails at request time instead of at boot.
   */
  requiredWith?: readonly string[];
}

export type EnvVarSpecs = Record<string, EnvVarSpec>;

export type EnvGroupValues<Specs extends EnvVarSpecs> = {
  [Key in keyof Specs]: z.infer<Specs[Key]["schema"]>;
};

export interface EnvGroup<Specs extends EnvVarSpecs = EnvVarSpecs> {
  /** Group name, used in validation error messages. */
  name: string;
  specs: Specs;
  /** Parse the group, throwing a message that names the offending variables. */
  read(): EnvGroupValues<Specs>;
}

function formatIssues(name: string, error: z.ZodError): string {
  const details = error.issues
    .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("\n");

  return `Invalid ${name} configuration:\n${details}`;
}

export function defineEnvGroup<const Specs extends EnvVarSpecs>(options: {
  name: string;
  specs: Specs;
  /**
   * Overrides where raw values come from. `lib/config/public.ts` uses this to
   * hand over literal `process.env.NEXT_PUBLIC_*` reads, which Next.js needs in
   * order to inline them into client bundles.
   */
  source?: () => RawEnv;
}): EnvGroup<Specs> {
  const { name, specs, source } = options;
  const names = Object.keys(specs);
  const shape: Record<string, z.ZodType> = {};
  for (const varName of names) {
    shape[varName] = specs[varName].schema;
  }
  const schema = z.object(shape);

  return {
    name,
    specs,
    read(): EnvGroupValues<Specs> {
      // Resolved on read, not captured at definition time: groups are defined
      // at module scope, before imported bindings are guaranteed initialized.
      const raw = source ? source() : readServerEnv();
      const input: RawEnv = {};
      for (const varName of names) {
        input[varName] = raw[varName];
      }

      const result = schema.safeParse(input);
      if (!result.success) {
        throw new Error(formatIssues(name, result.error));
      }

      return result.data as EnvGroupValues<Specs>;
    },
  };
}
