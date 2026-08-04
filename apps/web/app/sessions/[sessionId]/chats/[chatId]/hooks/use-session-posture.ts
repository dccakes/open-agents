"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Posture } from "@/lib/policy/posture";
import {
  loadSessionPosture,
  saveSessionPosture,
} from "@/lib/policy/session-posture-actions";

/**
 * The session's posture, as the header shows and changes it.
 *
 * `availablePostures` and `canSetDangerous` come from the server, so the client
 * never decides for itself which options exist. Hiding `dangerous` is a
 * courtesy for a user who cannot pick it; the server refuses it regardless of
 * what was rendered, which is why this hook does no permission logic at all.
 */

export interface SessionPostureControls {
  posture: Posture | null;
  availablePostures: Posture[];
  canSetDangerous: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  select: (posture: Posture) => void;
}

export function useSessionPosture(sessionId: string): SessionPostureControls {
  const [posture, setPosture] = useState<Posture | null>(null);
  const [availablePostures, setAvailablePostures] = useState<Posture[]>([]);
  const [canSetDangerous, setCanSetDangerous] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    loadSessionPosture(sessionId)
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.success) {
          setPosture(result.posture.posture);
          setAvailablePostures(result.posture.availablePostures);
          setCanSetDangerous(result.posture.canSetDangerous);
          setError(null);
          return;
        }
        setError(result.error);
      })
      .catch(() => {
        if (!cancelled) {
          setError("The session posture is unavailable right now.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const select = useCallback(
    (next: Posture) => {
      setSaving(true);
      setError(null);
      saveSessionPosture(sessionId, next)
        .then((result) => {
          if (result.success) {
            setPosture(result.posture.posture);
            setAvailablePostures(result.posture.availablePostures);
            setCanSetDangerous(result.posture.canSetDangerous);
            return;
          }
          // A refusal is shown, not swallowed: the server may reject a posture
          // the client thought it could offer.
          setError(result.error);
        })
        .catch(() => {
          setError("The posture could not be changed.");
        })
        .finally(() => {
          setSaving(false);
        });
    },
    [sessionId],
  );

  return useMemo(
    () => ({
      posture,
      availablePostures,
      canSetDangerous,
      loading,
      saving,
      error,
      select,
    }),
    [
      availablePostures,
      canSetDangerous,
      error,
      loading,
      posture,
      saving,
      select,
    ],
  );
}
