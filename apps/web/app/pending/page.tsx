import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionWithMembership } from "@/lib/session/get-server-session";
import { PendingApprovalScreen } from "./pending-approval-screen";

export const metadata: Metadata = {
  title: "Waiting for approval",
};

/**
 * The approval-request screen.
 *
 * Reads the membership-aware session because this is one of the few surfaces
 * that must *distinguish* pending from signed-out: a signed-out visitor
 * belongs on the sign-in page, and an approved member should never be parked
 * here after being approved.
 */
export default async function PendingPage() {
  const { session, approved } = await getSessionWithMembership();

  if (!session) {
    redirect("/");
  }

  if (approved) {
    redirect("/sessions");
  }

  return <PendingApprovalScreen email={session.user.email} />;
}
