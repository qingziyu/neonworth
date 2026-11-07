"use client";

import { useId } from 'react';
import { Rectangle, type RectangleProps } from 'recharts';

type ChartBarSkinProps = Pick<RectangleProps,
  'x' | 'y' | 'width' | 'height' | 'radius' | 'fill' | 'fillOpacity' | 'opacity' | 'stroke' | 'strokeWidth'> & {
  horizontal?: boolean;
};

/** A static skin for Recharts' own rectangle. No data or scale calculation lives
 * here; signed dimensions, corner radii and Cell/pattern fills pass through. */
export function ChartBarSkin({ x, y, width, height, radius, fill, fillOpacity, opacity, stroke, strokeWidth, horizontal = false }: ChartBarSkinProps) {
  const clipId = `chart-bar-${useId()}`;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof width !== 'number' || typeof height !== 'number' ||
    ![x, y, width, height].every(Number.isFinite) || width === 0 || height === 0) return null;
  const geometry = { x, y, width, height, radius, isAnimationActive: false, isUpdateAnimationActive: false };
  const base = <Rectangle {...geometry} className="chart-bar__base" fill={fill} fillOpacity={fillOpacity} stroke={stroke} strokeWidth={strokeWidth} />;
  // Below six pixels, preserve the full semantic fill: a one-pixel internal
  // edge would occupy too much of the mark. Its original geometry stays exact.
  if (Math.abs(width) < 6 || Math.abs(height) < 6) return <g opacity={opacity}>{base}</g>;
  const left = Math.min(x, x + width), right = Math.max(x, x + width);
  const top = Math.min(y, y + height), bottom = Math.max(y, y + height);
  // Recharts vertical bars begin at the current endpoint y and run back toward
  // baseline via signed height. Horizontal bars run from x to endpoint x+width.
  const cap = horizontal ? x + width - Math.sign(width) * .75 : y + Math.sign(height) * .75;
  return <g className="chart-bar" opacity={opacity}>
    {base}
    <defs><clipPath id={clipId}><Rectangle {...geometry} fill="#fff" stroke="none" /></clipPath></defs>
    <g className="chart-bar__detail" visibility="hidden" aria-hidden="true" pointerEvents="none" opacity={fillOpacity} clipPath={`url(#${clipId})`}>
      <Rectangle {...geometry} className="chart-bar__edge" fill="none" strokeWidth={2} />
      {horizontal ? <>
        <line className="chart-bar__highlight" x1={left + .75} x2={right - .75} y1={top + .75} y2={top + .75} strokeWidth={1} />
        <line className="chart-bar__cap" x1={cap} x2={cap} y1={top + .75} y2={bottom - .75} strokeWidth={1} />
      </> : <>
        <line className="chart-bar__highlight" x1={left + .75} x2={left + .75} y1={top + .75} y2={bottom - .75} strokeWidth={1} />
        <line className="chart-bar__cap" x1={left + .75} x2={right - .75} y1={cap} y2={cap} strokeWidth={1} />
      </>}
    </g>
  </g>;
}
