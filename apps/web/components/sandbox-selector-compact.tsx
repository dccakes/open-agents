"use client";

import { useState } from "react";
import { ChevronDown, CheckIcon } from "lucide-react";
import type { SandboxProviderType } from "@open-agents/sandbox";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

export type SandboxType = SandboxProviderType;

interface SandboxOption {
  id: SandboxType;
  name: string;
  description: string;
  beta?: boolean;
}

export const SANDBOX_OPTIONS: SandboxOption[] = [
  {
    id: "vercel",
    name: "Vercel",
    description: "Cloud sandbox",
  },
  {
    id: "docker",
    name: "Docker",
    description: "Local container sandbox",
  },
  {
    id: "daytona",
    name: "Daytona",
    description: "Persistent cloud workspace",
    beta: true,
  },
];

export const DEFAULT_SANDBOX_TYPE: SandboxType = "vercel";

interface SandboxSelectorCompactProps {
  value: SandboxType;
  onChange: (sandboxType: SandboxType) => void;
  availableTypes?: SandboxType[];
}

export function SandboxSelectorCompact({
  value,
  onChange,
  availableTypes,
}: SandboxSelectorCompactProps) {
  const [open, setOpen] = useState(false);

  const handleSelect = (sandboxType: SandboxType) => {
    onChange(sandboxType);
    setOpen(false);
  };

  const availableOptions = availableTypes
    ? SANDBOX_OPTIONS.filter((sandbox) => availableTypes.includes(sandbox.id))
    : SANDBOX_OPTIONS;
  const selectedSandbox = SANDBOX_OPTIONS.find((s) => s.id === value);
  const displayText = selectedSandbox?.name ?? value;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-300"
        >
          <span className="max-w-[100px] truncate">{displayText}</span>
          <ChevronDown className="h-3 w-3" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-0" align="start">
        <Command>
          <CommandList>
            <CommandEmpty>No sandbox types found.</CommandEmpty>
            <CommandGroup>
              {availableOptions.map((sandbox) => (
                <CommandItem
                  key={sandbox.id}
                  value={sandbox.id}
                  onSelect={() => handleSelect(sandbox.id)}
                >
                  <CheckIcon
                    className={cn(
                      "mr-2 size-4",
                      value === sandbox.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-1.5">
                      <span>{sandbox.name}</span>
                      {sandbox.beta ? (
                        <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-300">
                          beta
                        </span>
                      ) : null}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {sandbox.description}
                    </span>
                  </div>
                  {sandbox.id === DEFAULT_SANDBOX_TYPE && (
                    <span className="ml-auto text-xs text-muted-foreground">
                      default
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
