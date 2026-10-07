"use client";

import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

import { CanvasLabel } from "@/components/canvas/canvas-label";
import { CodeIcon } from "@/components/canvas/code-icon";
import { useIsAgentEditing } from "@/components/canvas/agent-presence";
import { useIsFreshArrival } from "@/components/canvas/canvas-motion-context";
import { isGithubSourceUrl } from "@/lib/code-catalog";
import { cn } from "@/lib/utils";
import type { CanvasNode, CodeSource } from "@/types/canvas";

const HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;
const COPIED_MS = 1500;

/** Name, then signature or rows in monospace, then `path:line` when the agent sent a source. */
export function CodeBlockRenderer({ id, data, selected }: NodeProps<CanvasNode>) {
  const isFreshArrival = useIsFreshArrival();
  const isAgentEditing = useIsAgentEditing("node", id);
  const isEntry = data.catalogId === "code-entry";

  return (
    <>
      <div
        {...(isEntry ? { "data-code-entry": "" } : {})}
        className={cn(
          "flex h-full w-full flex-col gap-1 overflow-hidden rounded-md border bg-elevated px-3 py-2 text-left text-sm",
          isEntry && "border-l-4 border-l-brand",
          selected ? "border-brand" : "border-surface-border",
          isFreshArrival && "canvas-node-arrive",
          isAgentEditing && "canvas-agent-editing",
        )}
      >
        <div className="flex items-center gap-2">
          <CodeIcon catalogId={data.catalogId!} className="text-copy-muted" />
          <CanvasLabel id={id} label={data.label} ariaLabel="Node label" className="min-w-0 font-medium" />
        </div>
        {data.signature ? <p className="truncate font-mono text-xs text-copy-secondary">{data.signature}</p> : null}
        {data.rows?.length ? (
          <ul className="min-h-0 overflow-hidden font-mono text-xs text-copy-secondary">
            {data.rows.map((row, index) => <li key={index} className="truncate">{row}</li>)}
          </ul>
        ) : null}
        {data.source ? <SourceLine source={data.source} /> : null}
      </div>
      {HANDLE_POSITIONS.map((position) => <Handle key={position} id={position} type="source" position={position} />)}
    </>
  );
}

function SourceLine({ source }: { source: CodeSource }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const text = source.line ? `${source.path}:${source.line}` : source.path;
  const className = "nodrag nopan mt-auto truncate text-left text-[11px] text-copy-muted hover:text-copy-primary hover:underline";

  // Re-checked here, not trusted from the snapshot parser: this is the line that renders an href.
  if (isGithubSourceUrl(source.url)) {
    return <a href={source.url} target="_blank" rel="noopener noreferrer" className={className}>{text}</a>;
  }

  return (
    <button
      type="button"
      className={className}
      onClick={async () => {
        await navigator.clipboard?.writeText(text);
        setCopied(true);
      }}
    >
      <span aria-live="polite">{copied ? "Copied" : text}</span>
    </button>
  );
}
