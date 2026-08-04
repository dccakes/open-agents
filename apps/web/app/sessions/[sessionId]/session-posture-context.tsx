"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Posture } from "@/lib/policy/posture";
import {
  loadSessionPosture,
  saveSessionPosture,
  type SessionPostureActionResult,
} from "@/lib/policy/session-posture-actions";
import type { SessionPostureView } from "@/lib/policy/session-posture";

/**
 * The session's posture, held once for the whole session view.
 *
 * A provider rather than a hook each consumer mounts, for two reasons. The
 * cheap one is that every mount ran its own `readSessionPosture`, which is an
 * authorization check and a database read for one session-wide string. The
 * load-bearing one is that separate mounts held *separate state*: changing the
 * posture in the header left the copy feeding the tool-call prompts naming the
 * old posture until something remounted.
 *
 * The current posture is seeded from the session row the layout already loaded
 * server-side, so it is correct on first paint and the fetch is only there to
 * learn which options this viewer may choose — that depends on a permission,
 * which the row does not carry.
 */

export interface SessionPostureControls {
  /** The posture in force. Seeded from the server-rendered session row. */
  posture: Posture;
  /** The postures to offer. Empty until the server has answered. */
  availablePostures: Posture[];
  saving: boolean;
  error: string | null;
  select: (posture: Posture) => void;
}

const SessionPostureContext = createContext<SessionPostureControls | undefined>(
  undefined,
);

const UNAVAILABLE = "The session posture is unavailable right now.";

export function SessionPostureProvider({
  sessionId,
  initialPosture,
  children,
}: {
  sessionId: string;
  initialPosture: Posture;
  children: ReactNode;
}) {
  const [view, setView] = useState<SessionPostureView | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyResult = useCallback((result: SessionPostureActionResult) => {
    if (result.success) {
      setView(result.posture);
      setError(null);
      return;
    }
    // A refusal is shown, not swallowed: the server may reject a posture the
    // client thought it could offer.
    setError(result.error);
  }, []);

  useEffect(() => {
    let cancelled = false;

    loadSessionPosture(sessionId)
      .then((result) => {
        if (!cancelled) {
          applyResult(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(UNAVAILABLE);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyResult, sessionId]);

  const select = useCallback(
    (next: Posture) => {
      setSaving(true);
      setError(null);
      saveSessionPosture(sessionId, next)
        .then(applyResult)
        .catch(() => {
          setError("The posture could not be changed.");
        })
        .finally(() => {
          setSaving(false);
        });
    },
    [applyResult, sessionId],
  );

  const value = useMemo<SessionPostureControls>(
    () => ({
      posture: view?.posture ?? initialPosture,
      availablePostures: view?.availablePostures ?? [],
      saving,
      error,
      select,
    }),
    [error, initialPosture, saving, select, view],
  );

  return (
    <SessionPostureContext.Provider value={value}>
      {children}
    </SessionPostureContext.Provider>
  );
}

export function useSessionPosture(): SessionPostureControls {
  const context = useContext(SessionPostureContext);
  if (!context) {
    throw new Error(
      "useSessionPosture must be used within a SessionPostureProvider",
    );
  }
  return context;
}
