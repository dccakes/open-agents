"use client";

import { Loader2, PauseCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  loadOrgSettings,
  type OrgSettingsInput,
  type OrgSettingsView,
  saveOrgSettings,
} from "@/lib/org/settings-actions";

/** Empty input means "unlimited", which is the column's NULL. */
function budgetToInput(value: number | null): string {
  return value === null ? "" : String(value);
}

export function OrgSettingsSection() {
  const [settings, setSettings] = useState<OrgSettingsView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [budgetInput, setBudgetInput] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    loadOrgSettings().then((result) => {
      if (cancelled) {
        return;
      }
      if (result.success) {
        setSettings(result.settings);
        setBudgetInput(budgetToInput(result.settings.dailyTokenBudget));
      } else {
        setLoadError(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const submit = useCallback(async (input: OrgSettingsInput) => {
    setPending(true);
    try {
      const result = await saveOrgSettings(input);
      if (result.success) {
        setSettings(result.settings);
        setBudgetInput(budgetToInput(result.settings.dailyTokenBudget));
        return true;
      }
      toast.error(result.error);
      return false;
    } finally {
      setPending(false);
    }
  }, []);

  async function handlePauseChange(nextPaused: boolean) {
    const saved = await submit({ agentRunsPaused: nextPaused });
    if (!saved) {
      return;
    }
    toast.success(
      nextPaused
        ? "New agent runs are paused in this deployment"
        : "Agent runs resumed",
    );
  }

  async function handleBudgetSave() {
    const trimmed = budgetInput.trim();
    const parsed = trimmed === "" ? null : Number(trimmed);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0)) {
      toast.error(
        "Enter a whole number of tokens, or leave it empty for no limit.",
      );
      return;
    }

    if (await submit({ dailyTokenBudget: parsed })) {
      toast.success(
        parsed === null
          ? "Daily token budget cleared"
          : `Daily token budget set to ${parsed.toLocaleString()} tokens`,
      );
    }
  }

  if (loadError) {
    return (
      <section className="rounded-lg border border-border">
        <div className="px-5 py-4">
          <h2 className="text-base font-semibold">Organization</h2>
          <p className="mt-1 text-sm text-muted-foreground">{loadError}</p>
        </div>
      </section>
    );
  }

  if (!settings) {
    return (
      <section className="space-y-3 rounded-lg border border-border px-5 py-4">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </section>
    );
  }

  const disabled = !settings.canUpdate || pending;

  return (
    <section className="rounded-lg border border-border">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-base font-semibold">Organization</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Settings shared by everyone in the organization.
        </p>
      </div>

      <div className="divide-y divide-border">
        <div className="flex items-start justify-between gap-4 px-5 py-4">
          <div className="space-y-1">
            <Label
              htmlFor="agent-runs-paused"
              className="flex items-center gap-2"
            >
              <PauseCircle className="size-4" />
              Pause agent runs
            </Label>
            {/*
              Both limits are stated because both are easy to assume away: the
              switch is not a stop button, and it is not deployment-wide.
            */}
            <p className="max-w-prose text-sm text-muted-foreground">
              Stops <strong>new</strong> runs from starting — interactive chats
              and Linear-triggered runs alike. Runs already in progress keep
              executing; stopping those is a separate, per-run action.
            </p>
            <p className="max-w-prose text-sm text-muted-foreground">
              Applies to <strong>this deployment only</strong>. Preview
              deployments read their own forked database, so they are unaffected
              by this switch.
            </p>
          </div>
          <Switch
            id="agent-runs-paused"
            checked={settings.agentRunsPaused}
            disabled={disabled}
            onCheckedChange={handlePauseChange}
          />
        </div>

        <div className="space-y-2 px-5 py-4">
          <Label htmlFor="daily-token-budget">Daily token budget</Label>
          <p className="max-w-prose text-sm text-muted-foreground">
            Tokens the organization may spend per day. Leave empty for no limit.
          </p>
          <div className="flex items-center gap-2">
            <Input
              id="daily-token-budget"
              inputMode="numeric"
              placeholder="Unlimited"
              className="max-w-56"
              value={budgetInput}
              disabled={disabled}
              onChange={(event) => setBudgetInput(event.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              disabled={
                disabled ||
                budgetInput.trim() === budgetToInput(settings.dailyTokenBudget)
              }
              onClick={handleBudgetSave}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </div>
        </div>
      </div>

      {settings.canUpdate ? null : (
        <p className="border-t border-border px-5 py-3 text-sm text-muted-foreground">
          You can see these settings but not change them.
        </p>
      )}
    </section>
  );
}
