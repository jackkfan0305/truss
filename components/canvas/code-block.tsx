"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { Handle, Position, useStore, useStoreApi, ViewportPortal, type NodeProps } from "@xyflow/react";

import { CanvasLabel } from "@/components/canvas/canvas-label";
import { CodeIcon } from "@/components/canvas/code-icon";
import {
  activeCodeBlock, arrowCardSide, isInsideModule, quietCardSide, setHoveredCodeBlock, setPinnedCodeBlock,
  useHoveredCodeModule, usePinnedCodeBlock, type CardSide,
} from "@/components/canvas/code-hover";
import { PreviewCard } from "@base-ui/react/preview-card";
import { Pin, PinOff } from "lucide-react";
import { useIsAgentEditing } from "@/components/canvas/agent-presence";
import { useIsFreshArrival } from "@/components/canvas/canvas-motion-context";
import { isGithubSourceUrl } from "@/lib/code-catalog";
import { cn } from "@/lib/utils";
import type { CanvasNode, CodeSource } from "@/types/canvas";

const HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;
const COPIED_MS = 1500;

/**
 * Name, then summary, then rows in monospace, then `path:line` when the agent sent a source.
 * The signature lives in the hover card, leaving the block's room to the summary.
 * Hovering a block with pseudocode opens it in a card beside the block.
 */
export function CodeBlockRenderer({ id, data, selected }: NodeProps<CanvasNode>) {
  const isFreshArrival = useIsFreshArrival();
  const isAgentEditing = useIsAgentEditing("node", id);
  const isEntry = data.catalogId === "code-entry";
  const [isOpen, setIsOpen] = useState(false);
  const [side, setSide] = useState<CardSide>("right");
  const store = useStoreApi<CanvasNode>();
  // A hovered module keeps its own blocks lit and fades the rest.
  const hoveredModule = useHoveredCodeModule();
  const isDimmed = useStore((state) =>
    hoveredModule !== null && !isInsideModule(id, hoveredModule, (nodeId) => state.nodeLookup.get(nodeId)?.parentId));
  const isPinned = usePinnedCodeBlock() === id;
  const isShown = isOpen || isPinned;
  useEffect(() => () => {
    setHoveredCodeBlock(id, false);
    setPinnedCodeBlock(null);
  }, [id]);

  // While the card shows: P pins or unpins it, Esc unpins, and the arrows move
  // it to that side of the block. Captured first so React Flow's own arrow
  // handling does not also nudge the selection.
  useEffect(() => {
    if (!isShown || !data.pseudocode?.length) return;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']") || event.metaKey || event.ctrlKey || event.altKey) return;
      if (activeCodeBlock() !== id) return;
      const arrow = arrowCardSide(event.key);
      if (event.key === "p" || event.key === "P") {
        setPinnedCodeBlock(isPinned ? null : id);
      } else if (event.key === "Escape" && isPinned) {
        setPinnedCodeBlock(null);
      } else if (arrow) {
        setSide(arrow);
      } else {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [id, isShown, isPinned, data.pseudocode]);

  const block = (
    <div
      {...(isEntry ? { "data-code-entry": "" } : {})}
      className={cn(
        "code-block flex h-full w-full flex-col gap-1 overflow-hidden rounded-md border bg-elevated px-3 py-2 text-left text-sm",
        isEntry && "border-l-4 border-l-brand",
        selected || isShown ? "border-brand" : "border-surface-border",
        isShown && "code-block-open",
        isDimmed && "code-dimmed",
        isFreshArrival && "canvas-node-arrive",
        isAgentEditing && "canvas-agent-editing",
      )}
    >
      <div className="flex items-start gap-2">
        <CodeIcon catalogId={data.catalogId!} className="text-copy-muted" />
        <CanvasLabel id={id} label={data.label} ariaLabel="Node label" className="min-w-0 font-medium leading-5" />
      </div>
      {data.summary ? <p className="line-clamp-3 text-xs text-copy-secondary">{data.summary}</p> : null}
      {data.rows?.length ? (
        <ul className="min-h-0 overflow-hidden font-mono text-xs text-copy-secondary">
          {data.rows.map((row, index) => <li key={index} className="truncate">{row}</li>)}
        </ul>
      ) : null}
      {data.source ? <SourceLine source={data.source} /> : null}
    </div>
  );

  const cardBody = (
    <>
    <button
      type="button"
      aria-label={isPinned ? "Unpin pseudocode" : "Pin pseudocode"}
      aria-pressed={isPinned}
      title={isPinned ? "Unpin (P)" : "Pin (P)"}
      onClick={() => setPinnedCodeBlock(isPinned ? null : id)}
      className={cn(
        "absolute top-2 right-2 rounded-md p-1.5 transition-colors hover:bg-subtle focus-visible:outline-2 focus-visible:outline-brand",
        isPinned ? "text-brand" : "text-copy-muted hover:text-copy-primary",
      )}
    >
      {isPinned ? <PinOff aria-hidden className="h-3.5 w-3.5" /> : <Pin aria-hidden className="h-3.5 w-3.5" />}
    </button>
    <PseudocodeCard id={id} data={data} />
    <p className="mt-2.5 ml-1 border-t border-surface-border pt-2 text-[11px] text-copy-muted">
      {isPinned ? "Pinned · arrows move · Esc or P to unpin" : "P to pin · arrows move"}
    </p>
    </>
  );

  // Where the block sits on the canvas, read only while its card is pinned.
  const pinnedBox = useStore((state) => {
    if (!isPinned) return null;
    const node = state.nodeLookup.get(id);
    return node ? `${node.internals.positionAbsolute.x},${node.internals.positionAbsolute.y},${node.measured.width ?? 0},${node.measured.height ?? 0}` : null;
  });

  return (
    <>
      {isPinned && pinnedBox ? (
        // Pinned, the card lives on the canvas itself: it pans and zooms with the
        // diagram and stays beside its block instead of following it in screen space.
        <ViewportPortal>
          <div
            className="code-hover-card code-hover-card-pinned nodrag nopan nowheel"
            style={pinnedCardStyle(pinnedBox, side)}
          >
            {cardBody}
          </div>
        </ViewportPortal>
      ) : null}
      {data.pseudocode?.length ? (
        <PreviewCard.Root
          open={isOpen && !isPinned}
          onOpenChange={(open) => {
            // Open on the side with the fewest connected blocks, so the lit path stays in view.
            if (open) {
              const { edges, nodeLookup } = store.getState();
              const box = (nodeId: string) => {
                const node = nodeLookup.get(nodeId);
                return node ? { ...node.internals.positionAbsolute, width: node.measured.width ?? 0, height: node.measured.height ?? 0 } : null;
              };
              const own = box(id);
              const connected = edges.flatMap((edge) =>
                edge.source === id ? [box(edge.target)] : edge.target === id ? [box(edge.source)] : []);
              if (own) setSide(quietCardSide(own, connected.filter((found) => found !== null)));
            }
            setIsOpen(open);
            setHoveredCodeBlock(id, open);
          }}
        >
          <PreviewCard.Trigger delay={250} closeDelay={100} render={<div className="h-full w-full" />}>{block}</PreviewCard.Trigger>
          <PreviewCard.Portal>
            <PreviewCard.Positioner
              side={side}
              align="start"
              sideOffset={12}
              collisionPadding={8}
              className="z-50"
            >
              <PreviewCard.Popup className="code-hover-card relative">
                {cardBody}
              </PreviewCard.Popup>
            </PreviewCard.Positioner>
          </PreviewCard.Portal>
        </PreviewCard.Root>
      ) : (
        // Types and enums have no card; hovering still lights their own edges.
        <div
          className="h-full w-full"
          onPointerEnter={() => { setIsOpen(true); setHoveredCodeBlock(id, true); }}
          onPointerLeave={() => { setIsOpen(false); setHoveredCodeBlock(id, false); }}
        >
          {block}
        </div>
      )}
      {HANDLE_POSITIONS.map((position) => <Handle key={position} id={position} type="source" position={position} />)}
    </>
  );
}

const CARD_GAP = 12;

/** Canvas placement for a pinned card on `side` of the block box "x,y,width,height". */
function pinnedCardStyle(box: string, side: CardSide): CSSProperties {
  const [x, y, width, height] = box.split(",").map(Number);
  const at = {
    right: { left: x + width + CARD_GAP, top: y, transform: "none" },
    left: { left: x - CARD_GAP, top: y, transform: "translateX(-100%)" },
    bottom: { left: x, top: y + height + CARD_GAP, transform: "none" },
    top: { left: x, top: y - CARD_GAP, transform: "translateY(-100%)" },
  }[side];
  return { position: "absolute", pointerEvents: "all", ...at };
}

/** Mounted only while the card is open, so the edge lookup never runs at rest. */
function PseudocodeCard({ id, data }: { id: string; data: CanvasNode["data"] }) {
  // Names of the blocks this one calls, so the pseudocode can mark them.
  const callees = useStore((state) => {
    const names = new Set<string>();
    for (const edge of state.edges) {
      if (edge.source !== id) continue;
      const label = state.nodeLookup.get(edge.target)?.data.label;
      if (typeof label === "string" && label) names.add(label);
    }
    return [...names].sort((a, b) => b.length - a.length).join("\u0000");
  });
  const pattern = callees
    ? new RegExp(`(${callees.split("\u0000").map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "g")
    : null;

  return (
    <>
      <p className="mr-8 ml-1 text-xs font-semibold tracking-wide text-copy-primary">{data.label}</p>
      {data.signature ? (
        <p className="mt-0.5 ml-1 border-b border-surface-border pb-2.5 font-mono text-xs break-all text-copy-secondary">{data.signature}</p>
      ) : null}
      <ol className="mt-2.5 font-mono text-xs leading-[1.7] text-copy-secondary">
        {data.pseudocode!.map((line, index) => (
          <li key={index} className="flex gap-3 whitespace-pre-wrap break-words" style={{ "--line": index } as CSSProperties}>
            <span aria-hidden className="w-4 shrink-0 text-right text-copy-muted">{index + 1}</span>
            <span className="min-w-0">
              {pattern
                ? line.split(pattern).map((part, at) => (at % 2 ? <span key={at} className="text-brand">{part}</span> : part))
                : line}
            </span>
          </li>
        ))}
      </ol>
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
