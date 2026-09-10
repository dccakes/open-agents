/**
 * Run the org-ownership migration and reconciliation by hand.
 *
 * Both routines are deliberately not wired to a route or a cron: promotion is
 * an explicit administrative act, and the Vercel migration is a one-shot whose
 * conflicts a person has to settle. This is the entry point for running them.
 *
 * Usage:
 *   bun run scripts/org-ownership.ts status
 *   bun run scripts/org-ownership.ts reconcile-installations [--apply]
 *
 * **Dry run by default.** Nothing is written unless `--apply` is passed, and
 * the target database is printed first — `reconcile-installations` deletes
 * organization-owned rows the GitHub App no longer holds, and preview
 * databases are Neon forks of production whose rows point at *real* external
 * resources. Pointing this at the wrong `POSTGRES_URL` is the one way to do
 * real damage with it, so it says which one it is every time.
 */

import { getDatabaseConfig } from "@/lib/config/db";
import {
  getAllOrgOwnedInstallations,
  getOrgInstallations,
} from "@/lib/db/installations";
import { listOrgGitHubAccounts } from "@/lib/db/org-github-accounts";
import {
  listAppInstallations,
  reconcileOrgInstallations,
} from "@/lib/github/reconcile-installations";
import { getSeededOrganizationId } from "@/lib/org/seeded-organization";

type Command = "status" | "reconcile-installations";

const COMMANDS: Command[] = ["status", "reconcile-installations"];

function usage(): never {
  console.error(
    [
      "Usage: bun run scripts/org-ownership.ts <command> [--apply]",
      "",
      "Commands:",
      "  status                   what the organization owns",
      "  reconcile-installations  converge org-owned installs on the App's own list",
      "",
      "Without --apply nothing is written.",
    ].join("\n"),
  );
  process.exit(1);
}

/** Host only — never print the credentials in the connection string. */
function describeDatabase(): string {
  const { url } = getDatabaseConfig();
  if (!url) {
    return "POSTGRES_URL is not set";
  }
  try {
    const parsed = new URL(url);
    return `${parsed.host}${parsed.pathname}`;
  } catch {
    return "unparseable POSTGRES_URL";
  }
}

async function requireOrganization(): Promise<string> {
  const organizationId = await getSeededOrganizationId();
  if (!organizationId) {
    console.error(
      "No seeded organization in this database. Start the app once so the seeder runs, then retry.",
    );
    process.exit(1);
  }
  return organizationId;
}

async function status(): Promise<void> {
  const organizationId = await requireOrganization();

  const [accounts, owned] = await Promise.all([
    listOrgGitHubAccounts(organizationId),
    getOrgInstallations(organizationId),
  ]);

  console.log(`\nOrganization ${organizationId}`);
  console.log(`  claimed GitHub accounts:      ${accounts.length}`);
  for (const account of accounts) {
    console.log(`    - ${account.accountLogin} (id ${account.accountId})`);
  }
  console.log(`  org-owned installations:      ${owned.length}`);
  for (const installation of owned) {
    console.log(
      `    - ${installation.accountLogin} (installation ${installation.installationId})`,
    );
  }
}

async function reconcileInstallations(apply: boolean): Promise<void> {
  await requireOrganization();

  if (!apply) {
    const [live, owned] = await Promise.all([
      listAppInstallations(),
      getAllOrgOwnedInstallations(),
    ]);
    const liveIds = new Set(live.map((entry) => entry.installationId));
    const stale = owned.filter(
      (installation) => !liveIds.has(installation.installationId),
    );

    console.log(`\nApp currently holds ${live.length} installations.`);
    console.log(`Would remove ${stale.length} stale org-owned records:`);
    for (const installation of stale) {
      console.log(
        `  - ${installation.accountLogin} (installation ${installation.installationId})`,
      );
    }
    return;
  }

  const outcome = await reconcileOrgInstallations();
  console.log(
    `\nRemoved ${outcome.removedInstallationIds.length} stale records, refreshed ${outcome.renamedAccountCount} renamed logins.`,
  );
}

async function main(): Promise<void> {
  const [rawCommand, ...rest] = process.argv.slice(2);
  const apply = rest.includes("--apply");

  if (!(rawCommand && COMMANDS.includes(rawCommand as Command))) {
    usage();
  }
  const command = rawCommand as Command;

  console.log(`Database: ${describeDatabase()}`);
  console.log(apply ? "Mode:     APPLY (writes)" : "Mode:     dry run");

  switch (command) {
    case "status":
      await status();
      break;
    case "reconcile-installations":
      await reconcileInstallations(apply);
      break;
  }

  if (!apply && command !== "status") {
    console.log("\nNothing written. Re-run with --apply to commit.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
