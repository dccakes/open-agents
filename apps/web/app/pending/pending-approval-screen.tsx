"use client";

import { Clock, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";

/**
 * The only screen a pending user sees.
 *
 * Deliberately offers no navigation into organization areas: the server
 * refuses those regardless, and showing links that all 403 would read as a
 * broken app rather than as an access decision.
 */
export function PendingApprovalScreen({ email }: { email?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 text-foreground">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-border p-8 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted">
          <Clock className="size-6 text-muted-foreground" />
        </div>

        <div className="space-y-2">
          <h1 className="text-xl font-semibold">Waiting for approval</h1>
          <p className="text-sm text-muted-foreground">
            You are signed in{email ? ` as ${email}` : ""}, but an administrator
            has to approve your access before you can use QuackOps.
          </p>
          <p className="text-sm text-muted-foreground">
            Ask an administrator to approve you. Once they do, this page will
            let you through on your next visit — you do not need to sign in
            again.
          </p>
        </div>

        <Button variant="outline" onClick={signOut} className="w-full">
          <LogOut className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  );
}
