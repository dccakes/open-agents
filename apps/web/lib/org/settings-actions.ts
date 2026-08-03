"use server";

/**
 * Server actions behind the admin-area organization settings UI.
 *
 * Reading is open to any approved member; updating is gated on
 * `orgSettings.update`, enforced in `updateOrgSettings` rather than here — the
 * `canUpdate` flag this module returns exists only to hide an affordance, and
 * hiding a control is not authorization.
 */

import { isAuthorizationError } from "@/lib/auth/authorization-error";
import {
  hasPermission,
  requireApprovedMember,
} from "@/lib/auth/require-permission";
import {
  isOrgSettingsError,
  readOrgSettings,
  updateOrgSettings,
} from "@/lib/org/settings";

export interface OrgSettingsView {
  agentRunsPaused: boolean;
  dailyTokenBudget: number | null;
  /** Whether the viewer may change these values. UI affordance only. */
  canUpdate: boolean;
}

export type OrgSettingsActionResult =
  | { success: true; settings: OrgSettingsView }
  | { success: false; error: string; status: number };

export interface OrgSettingsInput {
  agentRunsPaused?: boolean;
  dailyTokenBudget?: number | null;
}

function toActionError(error: unknown): OrgSettingsActionResult {
  // `status` travels with the result so a denial reads as 403 at the caller
  // rather than as an indistinguishable failure string.
  if (isAuthorizationError(error)) {
    return { success: false, error: error.message, status: error.status };
  }
  if (isOrgSettingsError(error)) {
    return { success: false, error: error.message, status: error.status };
  }

  const message = error instanceof Error ? error.message : String(error);
  console.error("[org-settings] Action failed:", message);
  return {
    success: false,
    error: "Organization settings are unavailable right now.",
    status: 500,
  };
}

/** The current settings, plus whether this viewer may change them. */
export async function loadOrgSettings(): Promise<OrgSettingsActionResult> {
  try {
    await requireApprovedMember();
    const settings = await readOrgSettings();
    return {
      success: true,
      settings: {
        agentRunsPaused: settings.agentRunsPaused,
        dailyTokenBudget: settings.dailyTokenBudget,
        canUpdate: await hasPermission({ orgSettings: ["update"] }),
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}

/** Apply a settings change. Denied callers get an error, not a silent no-op. */
export async function saveOrgSettings(
  input: OrgSettingsInput,
): Promise<OrgSettingsActionResult> {
  try {
    const settings = await updateOrgSettings(input);
    return {
      success: true,
      settings: {
        agentRunsPaused: settings.agentRunsPaused,
        dailyTokenBudget: settings.dailyTokenBudget,
        canUpdate: true,
      },
    };
  } catch (error) {
    return toActionError(error);
  }
}
