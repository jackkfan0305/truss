import { useEffect, type RefObject } from "react";
import { useReactFlow } from "@xyflow/react";

/** Screen pixels panned per pixel of wheel delta. */
const PAN_SPEED = 1.2;
/** Share of the remaining distance covered each frame; lower is smoother but laggier. */
const EASE = 0.35;

/**
 * Two-finger trackpad scroll pans the canvas, eased toward the target each
 * frame instead of jumping per wheel event. Pinch (ctrl+wheel) is left to
 * React Flow's zoomOnPinch.
 */
export function useSmoothScrollPan(ref: RefObject<HTMLElement | null>) {
  const { getViewport, setViewport } = useReactFlow();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let pendingX = 0;
    let pendingY = 0;
    let frame = 0;

    const step = () => {
      const dx = pendingX * EASE;
      const dy = pendingY * EASE;
      pendingX -= dx;
      pendingY -= dy;
      const { x, y, zoom } = getViewport();
      setViewport({ x: x - dx, y: y - dy, zoom });
      frame = Math.abs(pendingX) + Math.abs(pendingY) > 0.5 ? requestAnimationFrame(step) : 0;
    };

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      if ((event.target as Element).closest(".nowheel")) return;
      event.preventDefault();
      const scale = event.deltaMode === 1 ? 20 : 1;
      // Shift+wheel on a mouse scrolls sideways.
      const [deltaX, deltaY] = event.shiftKey && !event.deltaX ? [event.deltaY, 0] : [event.deltaX, event.deltaY];
      pendingX += deltaX * scale * PAN_SPEED;
      pendingY += deltaY * scale * PAN_SPEED;
      if (!frame) frame = requestAnimationFrame(step);
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      cancelAnimationFrame(frame);
    };
  }, [ref, getViewport, setViewport]);
}
