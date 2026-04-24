"use client";

import type { SandboxProviderType } from "@open-agents/sandbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface DefaultSandboxPickerOption {
  type: SandboxProviderType;
  label: string;
}

interface DefaultSandboxPickerProps {
  options: DefaultSandboxPickerOption[];
  value: SandboxProviderType | null;
  disabled?: boolean;
  onChange: (providerType: SandboxProviderType) => Promise<void>;
}

export function DefaultSandboxPicker({
  options,
  value,
  disabled = false,
  onChange,
}: DefaultSandboxPickerProps) {
  const isDisabled = disabled || options.length === 0;
  const selectedValue =
    value && options.some((option) => option.type === value)
      ? value
      : undefined;

  return (
    <div className="grid gap-2">
      <label htmlFor="default-sandbox-picker" className="text-sm font-medium">
        Default sandbox
      </label>
      <Select
        value={selectedValue}
        onValueChange={(nextValue) => {
          void onChange(nextValue as SandboxProviderType);
        }}
        disabled={isDisabled}
      >
        <SelectTrigger id="default-sandbox-picker" className="w-full max-w-sm">
          <SelectValue placeholder="No providers configured" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.type} value={option.type}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {options.length === 0 ? (
        <p className="text-xs text-muted-foreground">No providers configured</p>
      ) : null}
    </div>
  );
}
