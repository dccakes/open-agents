"use client";

import { Github, Loader2, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { OrgGitHubAccountView } from "@/lib/org/integration-ownership-actions";

interface Props {
  accounts: OrgGitHubAccountView[];
  canManage: boolean;
  pending: boolean;
  onClaim: (input: {
    accountId: number;
    accountLogin: string;
    accountType: "User" | "Organization";
  }) => Promise<{ success: boolean }>;
  onRelease: (
    accountId: number,
    accountLogin: string,
  ) => Promise<{ success: boolean }>;
}

export function GitHubAccountsSection({
  accounts,
  canManage,
  pending,
  onClaim,
  onRelease,
}: Props) {
  const [login, setLogin] = useState("");
  const [accountId, setAccountId] = useState("");

  async function handleClaim() {
    const parsedId = Number(accountId.trim());
    if (!Number.isInteger(parsedId) || parsedId <= 0) {
      return;
    }

    const result = await onClaim({
      accountId: parsedId,
      accountLogin: login.trim(),
      accountType: "Organization",
    });

    if (result.success) {
      setLogin("");
      setAccountId("");
    }
  }

  const disabled = !canManage || pending;

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <Github className="size-4" />
          Shared GitHub organizations
        </h2>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          App installations on these GitHub organizations belong to everyone
          here, so any approved member can start a session on their
          repositories. Members still need their own GitHub access to a
          repository — sharing an installation does not grant it.
        </p>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          Only GitHub <strong>organizations</strong> can be shared. An
          installation on someone&rsquo;s personal account covers their own
          repositories and stays theirs.
        </p>
      </div>

      <ul className="divide-y divide-border">
        {accounts.length === 0 ? (
          <li className="px-5 py-4 text-sm text-muted-foreground">
            No GitHub organizations are shared yet. Until one is, each member
            can only use installations they set up themselves.
          </li>
        ) : (
          accounts.map((account) => (
            <li
              key={account.accountId}
              className="flex items-center justify-between gap-4 px-5 py-3"
            >
              <div>
                <p className="text-sm font-medium">{account.accountLogin}</p>
                <p className="text-xs text-muted-foreground">
                  Account ID {account.accountId}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  onRelease(account.accountId, account.accountLogin)
                }
              >
                <Trash2 className="size-4" />
                Stop sharing
              </Button>
            </li>
          ))
        )}
      </ul>

      {canManage ? (
        <div className="space-y-2 border-t border-border px-5 py-4">
          <Label htmlFor="github-account-login">Share an organization</Label>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              id="github-account-login"
              placeholder="GitHub org login"
              className="max-w-56"
              value={login}
              disabled={pending}
              onChange={(event) => setLogin(event.target.value)}
            />
            <Input
              aria-label="GitHub numeric account ID"
              placeholder="Numeric account ID"
              inputMode="numeric"
              className="max-w-56"
              value={accountId}
              disabled={pending}
              onChange={(event) => setAccountId(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={
                pending || login.trim() === "" || accountId.trim() === ""
              }
              onClick={handleClaim}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Share
            </Button>
          </div>
          {/*
            The numeric id is asked for rather than derived from the login
            because it is what ownership is keyed on: a GitHub org can be
            renamed, and an uninstall/reinstall issues a new installation id,
            but the account id never changes.
          */}
          <p className="max-w-prose text-xs text-muted-foreground">
            The numeric ID is stable across renames — find it at{" "}
            <code>api.github.com/orgs/&lt;login&gt;</code>.
          </p>
          <p className="max-w-prose text-xs text-muted-foreground">
            Stopping sharing returns the installation to whoever set it up. It
            does not undo access members already used while it was shared.
          </p>
        </div>
      ) : (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          You can see which organizations are shared but not change them.
        </p>
      )}
    </section>
  );
}
