import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { ReactFlow, ReactFlowProvider, applyNodeChanges } from "@xyflow/react";

import { resolveShortcut } from "../lib/canvas-shortcuts";
import { createNoteNode } from "../lib/canvas-note";
import type { CanvasNode } from "../types/canvas";

// pretendToBeVisual gives jsdom the animation frames liquid-gooey schedules.
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
Object.assign(globalThis, {
  window: dom.window,
  document: dom.window.document,
  HTMLElement: dom.window.HTMLElement,
  HTMLTextAreaElement: dom.window.HTMLTextAreaElement,
  Element: dom.window.Element,
  Node: dom.window.Node,
  ShadowRoot: dom.window.ShadowRoot,
  KeyboardEvent: dom.window.KeyboardEvent,
  MouseEvent: dom.window.MouseEvent,
  requestAnimationFrame: dom.window.requestAnimationFrame,
  cancelAnimationFrame: dom.window.cancelAnimationFrame,
  getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
  MutationObserver: dom.window.MutationObserver,
  SVGElement: dom.window.SVGElement,
  DOMRect: dom.window.DOMRect,
  DOMMatrixReadOnly: class {
    m22 = 1;
    constructor() {}
  },
  // jsdom has no layout, so there is nothing to observe.
  ResizeObserver: class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
  IS_REACT_ACT_ENVIRONMENT: true,
});

// liquid-gooey reads the reduced-motion preference.
dom.window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as never;

const keys = (key: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean }> = {}) => ({
  key,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  ...extra,
});
assert.equal(resolveShortcut(keys("n")), "add-note");
assert.equal(resolveShortcut(keys("N")), "add-note");
assert.equal(resolveShortcut(keys("n", { metaKey: true })), null);

function typeInto(textarea: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

async function main() {
  // React decides whether `input` events work when it loads, so it loads after jsdom.
  const { createRoot } = await import("react-dom/client");
  const { useAddNoteShortcut } = await import("../hooks/use-keyboard-shortcuts");
  const { NoteButton } = await import("../components/canvas/note-button");
  const { NoteContextMenu } = await import("../components/canvas/note-context-menu");
  const { CanvasNoteRenderer } = await import("../components/canvas/canvas-note");
  const { markNoteForEditing } = await import("../lib/canvas-note-edit");
  const root = createRoot(document.getElementById("root")!);
  const query = <T extends Element = HTMLElement>(selector: string) => document.querySelector<T>(selector as never);

  // `N` adds a note, except while typing.
  let shortcutAdds = 0;
  function ShortcutProbe() {
    useAddNoteShortcut(() => shortcutAdds++);
    return <textarea aria-label="probe" />;
  }
  await act(async () => root.render(<ShortcutProbe />));
  await act(async () => window.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "n", bubbles: true })));
  assert.equal(shortcutAdds, 1);
  await act(async () =>
    query("textarea")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "n", bubbles: true })),
  );
  assert.equal(shortcutAdds, 1, "typing n in a text field adds nothing");

  // The dock button adds on click and starts a drag.
  let buttonAdds = 0;
  await act(async () => root.render(<NoteButton onAdd={() => buttonAdds++} />));
  const button = query<HTMLButtonElement>('button[aria-label="Add sticky note"]')!;
  assert.ok(button.draggable);
  await act(async () => button.click());
  assert.equal(buttonAdds, 1);

  // The context menu opens on empty canvas only.
  const menuAdds: Array<{ x: number; y: number }> = [];
  await act(async () =>
    root.render(
      <NoteContextMenu onAdd={(point) => menuAdds.push(point)}>
        <div className="react-flow__pane" id="pane">
          <div className="react-flow__node" id="node" />
          <div className="react-flow__edgelabel-renderer">
            <div id="edge-label">HTTPS</div>
          </div>
          <input id="field" />
        </div>
      </NoteContextMenu>,
    ),
  );
  const menuItem = () =>
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent?.includes("Add sticky note")) as
      | HTMLElement
      | undefined;
  await act(async () =>
    query("#node")!.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })),
  );
  assert.equal(menuItem(), undefined, "right-clicking a node keeps the browser menu");
  for (const id of ["#edge-label", "#field"]) {
    await act(async () =>
      query(id)!.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
    );
    assert.equal(menuItem(), undefined, `right-clicking ${id} keeps the browser menu`);
  }
  await act(async () =>
    query("#pane")!.dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 })),
  );
  assert.ok(menuItem(), "right-clicking empty canvas shows the item");
  await act(async () => menuItem()!.click());
  assert.deepEqual(menuAdds, [{ x: 40, y: 50 }]);

  // The note itself: edits on mount, commits on Escape, re-edits on double-click, recolours.
  const note = createNoteNode({ x: 100, y: 100 });
  markNoteForEditing(note.id);
  let latest: CanvasNode[] = [];
  function Harness() {
    const [nodes, setNodes] = useState<CanvasNode[]>([{ ...note, selected: true }]);
    latest = nodes;
    return (
      <div style={{ width: 800, height: 600 }}>
        <ReactFlow<CanvasNode>
          nodes={nodes}
          nodeTypes={{ canvasNote: CanvasNoteRenderer }}
          onNodesChange={(changes) => setNodes((current) => applyNodeChanges(changes, current))}
        />
      </div>
    );
  }
  await act(async () => root.render(<ReactFlowProvider><Harness /></ReactFlowProvider>));
  const textarea = query<HTMLTextAreaElement>('textarea[aria-label="Note text"]')!;
  assert.ok(textarea, "a new note mounts in editing mode");
  assert.equal(textarea.maxLength, 1000);
  await act(async () => typeInto(textarea, "Check quotas"));
  assert.equal(latest[0].data.label, "Check quotas");
  await act(async () => textarea.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  assert.equal(query('textarea[aria-label="Note text"]'), null, "Escape commits");
  await act(async () => query("[data-note-text]")!.dispatchEvent(new dom.window.MouseEvent("dblclick", { bubbles: true })));
  assert.ok(query('textarea[aria-label="Note text"]'), "double-click edits again");
  await act(async () => typeInto(query<HTMLTextAreaElement>('textarea[aria-label="Note text"]')!, ""));
  await act(async () => query<HTMLTextAreaElement>('textarea[aria-label="Note text"]')!.blur());
  assert.equal(query("[data-note-text]")!.textContent, "Write a note…");
  await act(async () => query<HTMLButtonElement>('[aria-label="Note color"] button[aria-label="pink"]')!.click());
  assert.equal(latest[0].data.noteColor, "pink");

  await act(async () => root.unmount());
  console.log("verify-canvas-note: ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
