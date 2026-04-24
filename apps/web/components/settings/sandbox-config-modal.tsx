"use client";

import type { SandboxConfigField } from "@open-agents/sandbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { SandboxConfigForm } from "./sandbox-config-form";

interface SandboxConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  providerLabel: string;
  fields: SandboxConfigField[];
  initialConfig: Record<string, string>;
  secretConfigKeys: string[];
  onSave: (config: Record<string, string>) => Promise<void>;
  isSaving?: boolean;
}

export function SandboxConfigModal({
  open,
  onOpenChange,
  providerLabel,
  fields,
  initialConfig,
  secretConfigKeys,
  onSave,
  isSaving = false,
}: SandboxConfigModalProps) {
  const handleSave = async (config: Record<string, string>) => {
    await onSave(config);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{providerLabel} Settings</DialogTitle>
          <DialogDescription>
            Update the configuration for this sandbox provider.
          </DialogDescription>
        </DialogHeader>

        <SandboxConfigForm
          fields={fields}
          initialConfig={initialConfig}
          secretConfigKeys={secretConfigKeys}
          onSave={handleSave}
          isSaving={isSaving}
          saveLabel="Save changes"
          onCancel={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}
