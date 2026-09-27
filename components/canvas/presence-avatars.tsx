"use client";

import { useAgentPresence } from "@/components/canvas/agent-presence";
import { getInitials } from "@/lib/presence";
import { AI_USER_COLOR, AI_USER_NAME } from "@/types/tasks";

/**
 * The agent's avatar while it draws, beside the Clerk `UserButton`. With no
 * agent drawing it renders nothing and the navbar is unchanged.
 */
export function PresenceAvatars() {
  const agent = useAgentPresence();

  if (!agent) {
    return null;
  }

  return (
    <div className="flex items-center gap-2">
      <ul aria-label="1 other person in this canvas" className="flex items-center -space-x-2">
        <li>
          <span
            title={AI_USER_NAME}
            className="flex h-7 w-7 items-center justify-center overflow-hidden rounded-full bg-elevated text-[10px] font-medium text-copy-primary ring-2 ring-page"
            style={{ outline: `2px solid ${AI_USER_COLOR}`, outlineOffset: "-2px" }}
          >
            <span aria-hidden>{getInitials(AI_USER_NAME)}</span>
            <span className="sr-only">{AI_USER_NAME}</span>
          </span>
        </li>
      </ul>
      <span aria-hidden className="h-5 w-px bg-surface-border" />
    </div>
  );
}
