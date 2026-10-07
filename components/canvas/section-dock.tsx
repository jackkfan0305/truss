"use client";

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { ChevronLeft, Cloud, Shapes, type LucideIcon } from "lucide-react";

import { AwsPanel } from "@/components/canvas/aws-panel";
import { AWS_CATEGORIES } from "@/lib/dock-ui";
import { ShapePanel } from "@/components/canvas/shape-panel";
import { AWS_CATALOG } from "@/lib/aws-catalog";
import { FLOATING_SURFACE } from "@/lib/floating-surface";
import { cn } from "@/lib/utils";
import { NODE_SHAPES, type NodeShape } from "@/types/canvas";

type SectionId = "basic" | "aws";

interface Section {
  id: SectionId;
  name: string;
  /** The tab's accessible name; also names the open panel. */
  label: string;
  icon: LucideIcon;
  count: number;
  /** Chips above the grid; a section with none shows no chip row. */
  categories: readonly string[];
  /** Open size in px, capped by the viewport. */
  width: number;
  height: number;
}

/** A new item family (GCP, flowchart, …) is one more entry here plus its panel below. */
const SECTIONS: readonly Section[] = [
  { id: "basic", name: "Basic", label: "Basic shapes", icon: Shapes, count: NODE_SHAPES.length, categories: [], width: 560, height: 240 },
  { id: "aws", name: "AWS", label: "AWS items", icon: Cloud, count: AWS_CATALOG.length, categories: AWS_CATEGORIES, width: 760, height: 340 },
];

/** 46px of tabs plus the 1px border, to match the 48px note button and controls blob. */
const TABS_HEIGHT = 48;

/** The two layers cross-fade through a blur while the dock resizes under them. */
const LAYER_CLASS =
  "absolute inset-0 transition-[filter,opacity,transform] duration-[450ms,400ms,500ms] ease-[var(--ease-smooth-out)] motion-reduce:transition-none";
const HIDDEN_LAYER_CLASS = "pointer-events-none scale-[0.96] opacity-0 blur-[14px]";

interface SectionDockProps {
  onAddShape: (shape: NodeShape) => void;
  onAddAws: (catalogId: string) => void;
}

/**
 * The bottom dock: one tab per item section. Opening a section grows the dock
 * to the section's size while the tabs blur out and the panel blurs in, then
 * its tiles unblur one after another. Escape or the back button reverses it and
 * returns focus to the section's tab.
 */
export function SectionDock({ onAddShape, onAddAws }: SectionDockProps) {
  const [openId, setOpenId] = useState<SectionId | null>(null);
  // The last opened section stays rendered while the panel blurs out.
  const [shownId, setShownId] = useState<SectionId>("basic");
  // Bumped on every open so the tiles remount and replay their unblur.
  const [openCount, setOpenCount] = useState(0);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string | null>(null);
  const [tabsWidth, setTabsWidth] = useState<number>();
  const tabsRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Partial<Record<SectionId, HTMLButtonElement | null>>>({});
  const returnFocusTo = useRef<SectionId | null>(null);
  const shown = SECTIONS.find((section) => section.id === shownId)!;
  const isOpen = openId !== null;

  // Re-measured on resize: the webfont can land after mount and narrow the
  // labels. The 2px is the dock's border, which the width includes.
  useLayoutEffect(() => {
    const tabs = tabsRef.current;
    if (!tabs) return;
    const measure = () => setTabsWidth(tabs.scrollWidth + 2);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (isOpen) {
      // Wait for the dock to start growing so the caret doesn't land mid-blur.
      const timer = setTimeout(() => searchRef.current?.focus({ preventScroll: true }), 300);
      return () => clearTimeout(timer);
    }
    if (returnFocusTo.current) {
      tabRefs.current[returnFocusTo.current]?.focus();
      returnFocusTo.current = null;
    }
  }, [isOpen]);

  const open = (id: SectionId) => {
    setOpenId(id);
    setShownId(id);
    setOpenCount((count) => count + 1);
    setQuery("");
    setCategory(null);
  };

  const close = () => {
    returnFocusTo.current = openId;
    setOpenId(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape" || !isOpen) return;
    event.stopPropagation();
    close();
  };

  return (
    <div
      onKeyDown={handleKeyDown}
      className={cn(
        FLOATING_SURFACE,
        "relative overflow-hidden transition-[width,height,border-radius] duration-500 ease-[var(--ease-smooth-out)] motion-reduce:transition-none",
        isOpen ? "rounded-[18px]" : "rounded-[24px]",
      )}
      style={{
        width: isOpen ? `min(${shown.width}px, calc(100vw - 2rem))` : tabsWidth,
        height: isOpen ? `min(${shown.height}px, 60vh)` : TABS_HEIGHT,
      }}
    >
      <div inert={isOpen} className={cn(LAYER_CLASS, isOpen && HIDDEN_LAYER_CLASS)}>
        <div ref={tabsRef} role="toolbar" aria-label="Item sections" className="flex h-[46px] w-max items-center gap-1 p-[5px]">
          {SECTIONS.map(({ id, name, label, icon: Icon, count }) => (
            <button
              key={id}
              ref={(element) => {
                tabRefs.current[id] = element;
              }}
              type="button"
              aria-label={label}
              onClick={() => open(id)}
              className="flex h-9 items-center gap-2 whitespace-nowrap rounded-full px-3.5 text-sm text-copy-secondary transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <Icon className="h-5 w-5" aria-hidden />
              {name}
              <span className="font-mono text-[11px] text-copy-muted">{count}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        role="region"
        aria-label={shown.label}
        inert={!isOpen}
        className={cn(LAYER_CLASS, "flex flex-col", !isOpen && HIDDEN_LAYER_CLASS)}
      >
        <div className="flex items-center gap-2.5 border-b border-surface-border px-3 pb-2 pt-2.5">
          <button
            type="button"
            aria-label="Back to sections"
            onClick={close}
            className="flex h-8 w-8 items-center justify-center rounded-full text-copy-muted transition-colors hover:bg-subtle hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-brand"
          >
            <ChevronLeft className="h-[18px] w-[18px]" aria-hidden />
          </button>
          <h2 className="font-semibold text-copy-primary">{shown.name}</h2>
          <input
            ref={searchRef}
            type="search"
            aria-label={`Search ${shown.label}`}
            placeholder="Search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="ml-auto w-[180px] rounded-lg border border-surface-border bg-page px-2.5 py-1.5 text-[13px] text-copy-primary placeholder:text-copy-muted focus:outline-1 focus:outline-brand max-sm:w-[110px]"
          />
        </div>

        {shown.categories.length > 0 ? (
          <div role="group" aria-label="Categories" className="flex gap-1 overflow-x-auto px-3 pt-2 [scrollbar-width:none]">
            {[null, ...shown.categories].map((value) => (
              <button
                key={value ?? "all"}
                type="button"
                aria-pressed={category === value}
                onClick={() => setCategory(value)}
                className={cn(
                  "whitespace-nowrap rounded-xl px-2.5 py-1 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-brand",
                  category === value ? "bg-subtle text-copy-primary" : "text-copy-muted hover:text-copy-primary",
                )}
              >
                {value ?? "All"}
              </button>
            ))}
          </div>
        ) : null}

        <div key={openCount} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3 pt-2.5">
          {shown.id === "basic" ? (
            <ShapePanel query={query} onAddShape={onAddShape} />
          ) : (
            <AwsPanel query={query} category={category} onAddEntry={onAddAws} />
          )}
        </div>
      </div>
    </div>
  );
}
