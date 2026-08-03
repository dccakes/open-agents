/**
 * Rendering and parsing for `apps/web/.env.example`.
 *
 * The file is generated from the config modules so it cannot drift from the
 * schemas: `scripts/generate-env-example.ts` writes it and
 * `env-example.test.ts` fails when the checked-in copy is stale.
 */

import {
  type CatalogEntry,
  configGroups,
  getEnvCatalog,
} from "@/lib/config/registry";

const HEADER = `# Environment variables for the QuackOps web app.
#
# Generated from lib/config/** — do not edit by hand.
# Regenerate with: bun run --cwd apps/web env:example
#
# axis:
#   required-prod  must be set on a production deployment (boot fails without it)
#   optional       feature-gated, or has a working default
#   dev-only       only meaningful in local development
#
# Secrets are left blank on purpose. Never commit real values.
`;

function wrapComment(text: string): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "#";

  for (const word of words) {
    if (current.length + word.length + 1 > 79 && current !== "#") {
      lines.push(current);
      current = "#";
    }
    current = `${current} ${word}`;
  }

  lines.push(current);
  return lines;
}

function renderEntry(entry: CatalogEntry): string {
  const { name, spec } = entry;
  const qualifiers = [`axis: ${spec.axis}`];
  if (spec.secret) {
    qualifiers.push("secret");
  }
  if (spec.requiredWith && spec.requiredWith.length > 0) {
    qualifiers.push(`required with ${spec.requiredWith.join(", ")}`);
  }

  const lines = [
    ...wrapComment(spec.description),
    `# ${qualifiers.join(" | ")}`,
    `${name}=${spec.secret ? "" : (spec.example ?? "")}`,
  ];

  return lines.join("\n");
}

/** Render the full `.env.example` contents. */
export function renderEnvExample(): string {
  const catalog = getEnvCatalog();
  const sections = configGroups.map((group) => {
    const entries = catalog.filter((entry) => entry.group === group.name);
    return [
      `# --- ${group.name} ---`,
      "",
      entries.map(renderEntry).join("\n\n"),
    ].join("\n");
  });

  return `${HEADER}\n${sections.join("\n\n")}\n`;
}

/** Parse `KEY=value` lines out of an env file, ignoring comments and blanks. */
export function parseEnvFile(contents: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    values[trimmed.slice(0, separatorIndex)] = trimmed.slice(
      separatorIndex + 1,
    );
  }

  return values;
}
