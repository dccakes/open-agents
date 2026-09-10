"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface RemoveMemberDialogProps {
  memberLabel: string | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * The removal confirmation.
 *
 * The copy states the limit of what removal does, because "remove a member"
 * reads as complete and is not: their sessions and share links die, but an
 * agent run already executing keeps running in a sandbox holding their GitHub
 * token. Terminating that is the admin runs dashboard's per-run stop (WS-1.5).
 */
export function RemoveMemberDialog({
  memberLabel,
  busy,
  onCancel,
  onConfirm,
}: RemoveMemberDialogProps) {
  return (
    <Dialog
      open={memberLabel !== null}
      onOpenChange={(open) => {
        if (!open) {
          onCancel();
        }
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Remove {memberLabel} from the organization?</DialogTitle>
          <DialogDescription className="space-y-3">
            <span className="block">
              They lose access immediately: their membership row is deleted,
              their active sessions are revoked, and every share link they
              published stops resolving.
            </span>
            <span className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-500">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              Agent runs that are already executing are not stopped by this.
              Stop those individually from the runs dashboard.
            </span>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={busy}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? "Removing…" : "Remove member"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
