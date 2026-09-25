"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import type { XYPosition } from "@xyflow/react";

/** The agent's cursor while a replay draws on this tab's canvas. */
export interface AgentPresence {
  cursor: XYPosition | null;
}

interface AgentPresenceValue {
  presence: AgentPresence | null;
  setPresence: (presence: AgentPresence | null) => void;
}

const AgentPresenceContext = createContext<AgentPresenceValue | null>(null);

/**
 * Spans the navbar and the canvas, like the room provider it replaces: the
 * avatar sits in one and the cursor in the other.
 */
export function AgentPresenceProvider({ children }: { children: ReactNode }) {
  const [presence, setPresence] = useState<AgentPresence | null>(null);
  const value = useMemo(() => ({ presence, setPresence }), [presence]);

  return <AgentPresenceContext value={value}>{children}</AgentPresenceContext>;
}

/** `null` whenever the agent is not drawing. Safe outside a provider. */
export function useAgentPresence(): AgentPresence | null {
  return useContext(AgentPresenceContext)?.presence ?? null;
}

export function useSetAgentPresence(): (presence: AgentPresence | null) => void {
  const value = useContext(AgentPresenceContext);

  if (!value) {
    throw new Error("useSetAgentPresence must be used inside an AgentPresenceProvider");
  }

  return value.setPresence;
}
