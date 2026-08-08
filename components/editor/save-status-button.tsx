"use client";

import { AlertCircle, Check, Loader2, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SaveStatus } from "@/hooks/use-canvas-autosave";
import { cn } from "@/lib/utils";

interface SaveStatusButtonProps {
  status: SaveStatus;
  onSave: () => void;
}

/**
 * The navbar Save control and autosave indicator in one (21-canvas-autosave).
 *
 * The canvas saves itself, so this is mostly a readout — but it stays a real
 * button rather than a label because "is my work safe" is exactly when someone
 * reaches for Save, and making them wait out a debounce to find out is worse
 * than one extra write.
 */
export function SaveStatusButton({ status, onSave }: SaveStatusButtonProps) {
  const { Icon, label, tone, isSpinning } = DISPLAY[status];

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onSave}
      // Not `disabled`: a disabled control loses focus and stops being
      // announced mid-save. `aria-busy` says the same thing without that.
      aria-busy={status === "saving"}
      aria-label={label}
    >
      <Icon className={cn("h-4 w-4", tone, isSpinning && "animate-spin")} />
      <span className={cn("hidden sm:inline", tone)}>{label}</span>
    </Button>
  );
}

const DISPLAY: Record<
  SaveStatus,
  {
    Icon: typeof Save;
    label: string;
    tone: string;
    isSpinning?: boolean;
  }
> = {
  // Nothing has changed since the canvas loaded, so there is nothing to report
  // yet — the neutral state reads as "Save" rather than as a claim either way.
  idle: { Icon: Save, label: "Save", tone: "text-copy-secondary" },
  saving: {
    Icon: Loader2,
    label: "Saving…",
    tone: "text-copy-muted",
    isSpinning: true,
  },
  saved: { Icon: Check, label: "Saved", tone: "text-state-success" },
  error: { Icon: AlertCircle, label: "Save failed", tone: "text-state-error" },
};
