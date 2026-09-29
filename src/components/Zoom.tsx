"use client";

// Zoom and pan on a camera picture — for people looking closely (the eye, the
// nostrils, the bedding). Only the view changes: what the camera records and
// what the system measures stay the same.
//
// Scroll or pinch (trackpad) to zoom towards the pointer, drag to pan,
// double-click to zoom in, and buttons for touch screens. The view is kept
// while the picture refreshes, and can be shared between the thermal and
// colour pictures, which show about the same area.
import { useEffect, useRef, type ReactNode } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";

/** z: zoom (1 = whole picture); x, y: the centre of the view, 0..1 of the picture. */
export type ZoomView = { z: number; x: number; y: number };
export const WHOLE: ZoomView = { z: 1, x: 0.5, y: 0.5 };
const MAX = 8;

const clampView = ({ z, x, y }: ZoomView): ZoomView => {
  const zz = Math.min(MAX, Math.max(1, z));
  const half = 0.5 / zz;
  return { z: zz, x: Math.min(1 - half, Math.max(half, x)), y: Math.min(1 - half, Math.max(half, y)) };
};

/** Zoom by `factor` keeping the picture point under (u, v) — 0..1 of the frame — where it is. */
export function zoomAt(view: ZoomView, factor: number, u = 0.5, v = 0.5): ZoomView {
  const z = Math.min(MAX, Math.max(1, view.z * factor));
  const px = view.x + (u - 0.5) / view.z, py = view.y + (v - 0.5) / view.z;
  return clampView({ z, x: px - (u - 0.5) / z, y: py - (v - 0.5) / z });
}

/** children: an overlay in the picture's own 0–100 % coordinates (e.g. where
 *  something was found); it zooms and pans with the picture. */
export function ZoomImage({ src, alt, view, onView, children }: {
  src: string; alt: string; view: ZoomView; onView: (v: ZoomView) => void; children?: ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const drag = useRef<{ id: number; u: number; v: number; x: number; y: number } | null>(null);

  const rel = (e: { clientX: number; clientY: number }) => {
    const r = frame.current!.getBoundingClientRect();
    return { u: (e.clientX - r.left) / r.width, v: (e.clientY - r.top) / r.height };
  };

  // Wheel needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { u, v } = rel(e);
      const step = e.ctrlKey ? Math.exp(-e.deltaY / 100) : e.deltaY < 0 ? 1.25 : 1 / 1.25;   // ctrl: trackpad pinch
      onView(zoomAt(viewRef.current, step, u, v));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [onView]);

  const { z, x, y } = view;
  return (
    <div className="zoom">
      <div
        ref={frame}
        className={`zoom-frame${z > 1 ? " zoomed" : ""}`}
        onPointerDown={(e) => {
          if (viewRef.current.z <= 1) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          const { u, v } = rel(e);
          drag.current = { id: e.pointerId, u, v, x: viewRef.current.x, y: viewRef.current.y };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || d.id !== e.pointerId) return;
          const { u, v } = rel(e);
          onView(clampView({ z: viewRef.current.z, x: d.x - (u - d.u) / viewRef.current.z, y: d.y - (v - d.v) / viewRef.current.z }));
        }}
        onPointerUp={() => { drag.current = null; }}
        onPointerCancel={() => { drag.current = null; }}
        onDoubleClick={(e) => { const { u, v } = rel(e); onView(view.z >= MAX ? WHOLE : zoomAt(view, 2, u, v)); }}
      >
        <div className="zoom-content" style={{ transform: `scale(${z}) translate(${(0.5 - x) * 100}%, ${(0.5 - y) * 100}%)` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} draggable={false} />
          {children}
        </div>
      </div>
      <div className="zoom-bar">
        <button type="button" aria-label="Zoom out" disabled={z <= 1} onClick={() => onView(zoomAt(view, 1 / 1.5))}><Minus size={14} /></button>
        <span>{Math.round(z * 100)}%</span>
        <button type="button" aria-label="Zoom in" disabled={z >= MAX} onClick={() => onView(zoomAt(view, 1.5))}><Plus size={14} /></button>
        <button type="button" aria-label="Whole picture" disabled={z <= 1} onClick={() => onView(WHOLE)}><Maximize2 size={13} /></button>
      </div>
    </div>
  );
}
