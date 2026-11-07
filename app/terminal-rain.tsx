"use client";

import { useEffect, useId, useRef } from 'react';
import { bindAmbientMotion } from './ambient-motion';
import { createBinaryRainRenderer, type BinaryRainRenderer } from './binary-rain-renderer';
import './terminal-rain.css';

// SSR and missing-capability fallback. Binary decoration only, never source text.
const STATIC_CELLS = Array.from({ length: 24 }, (_, index) => ({
  x: [20, 78, 148][Math.floor(index / 8)], y: 20 + index % 8 * 23 + Math.floor(index / 8) * 29,
  digit: (index * 7 + Math.floor(index / 3)) % 2 === 0 ? '0' : '1',
  opacity: Number((.12 + index % 8 * .09).toFixed(2)), head: index % 8 === 7,
}));

export function bindTerminalRain(field: HTMLElement, enabled: boolean, renderer: BinaryRainRenderer) {
  return bindAmbientMotion(field, enabled, active => renderer.setActive(active));
}

export function TerminalRainBackdrop({ enabled }: { enabled: boolean }) {
  const fieldRef = useRef<HTMLDivElement>(null), canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BinaryRainRenderer | null>(null);
  const patternId = `binary-rain-${useId()}`;
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = createBinaryRainRenderer(canvas);
    rendererRef.current = renderer;
    return () => { renderer?.dispose(); rendererRef.current = null; };
  }, []);
  useEffect(() => {
    const field = fieldRef.current, renderer = rendererRef.current;
    if (field && renderer) return bindTerminalRain(field, enabled, renderer);
  }, [enabled]);
  return <div className="terminal-rain" aria-hidden="true" ref={fieldRef}>
    <canvas className="terminal-rain__canvas" ref={canvasRef} />
    <svg className="terminal-rain__fallback" width="100%" height="100%" focusable="false">
      <defs><pattern id={patternId} width="192" height="320" patternUnits="userSpaceOnUse">
        {STATIC_CELLS.map((cell, index) => <text key={index} x={cell.x} y={cell.y} opacity={cell.opacity}
          className={cell.head ? 'terminal-rain__head' : index < 8 ? 'terminal-rain__teal' : undefined}>{cell.digit}</text>)}
      </pattern></defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  </div>;
}
