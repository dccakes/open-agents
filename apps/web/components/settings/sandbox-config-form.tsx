"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { SandboxConfigField } from "@open-agents/sandbox";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface SandboxConfigFormProps {
  fields: SandboxConfigField[];
  initialConfig: Record<string, string>;
  secretConfigKeys: string[];
  onSave: (config: Record<string, string>) => Promise<void>;
  onCancel?: () => void;
  isSaving?: boolean;
  saveLabel?: string;
}

function buildInitialValues(
  fields: SandboxConfigField[],
  initialConfig: Record<string, string>,
): Record<string, string> {
  const initialValues: Record<string, string> = {};

  for (const field of fields) {
    initialValues[field.key] =
      field.type === "password" ? "" : (initialConfig[field.key] ?? "");
  }

  return initialValues;
}

export function SandboxConfigForm({
  fields,
  initialConfig,
  secretConfigKeys,
  onSave,
  onCancel,
  isSaving = false,
  saveLabel = "Save",
}: SandboxConfigFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    buildInitialValues(fields, initialConfig),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const secretConfigKeySet = useMemo(
    () => new Set(secretConfigKeys),
    [secretConfigKeys],
  );

  useEffect(() => {
    setValues(buildInitialValues(fields, initialConfig));
    setErrors({});
    setFormError(null);
  }, [fields, initialConfig]);

  const handleValueChange = (key: string, value: string) => {
    setValues((currentValues) => ({
      ...currentValues,
      [key]: value,
    }));

    setErrors((currentErrors) => {
      if (!currentErrors[key]) {
        return currentErrors;
      }

      const nextErrors = { ...currentErrors };
      delete nextErrors[key];
      return nextErrors;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const nextErrors: Record<string, string> = {};
    const configPatch: Record<string, string> = {};

    for (const field of fields) {
      const rawValue = values[field.key] ?? "";
      const trimmedValue = rawValue.trim();
      const hasExistingSecret = secretConfigKeySet.has(field.key);

      if (field.type === "password") {
        if (!trimmedValue && field.required && !hasExistingSecret) {
          nextErrors[field.key] = "This field is required";
          continue;
        }

        if (trimmedValue) {
          configPatch[field.key] = trimmedValue;
        }

        continue;
      }

      if (!trimmedValue && field.required) {
        nextErrors[field.key] = "This field is required";
      }

      configPatch[field.key] = trimmedValue;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setFormError(null);

    try {
      await onSave(configPatch);
    } catch (error) {
      setFormError(
        error instanceof Error ? error.message : "Failed to save configuration",
      );
    }
  };

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      {fields.map((field) => {
        const hasExistingSecret = secretConfigKeySet.has(field.key);
        const placeholder =
          field.type === "password" && hasExistingSecret
            ? "Saved value (leave blank to keep current value)"
            : field.placeholder;

        return (
          <div key={field.key} className="grid gap-1.5">
            <Label htmlFor={`sandbox-config-${field.key}`}>
              {field.label}
              {field.required ? " *" : ""}
            </Label>
            <Input
              id={`sandbox-config-${field.key}`}
              type={field.type === "password" ? "password" : field.type}
              value={values[field.key] ?? ""}
              placeholder={placeholder}
              onChange={(event) =>
                handleValueChange(field.key, event.currentTarget.value)
              }
              disabled={isSaving}
              autoComplete="off"
            />
            {errors[field.key] ? (
              <p className="text-xs text-destructive">{errors[field.key]}</p>
            ) : null}
          </div>
        );
      })}

      {formError ? (
        <p className="text-sm text-destructive">{formError}</p>
      ) : null}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={isSaving}>
          {isSaving ? "Saving..." : saveLabel}
        </Button>
        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </form>
  );
}
