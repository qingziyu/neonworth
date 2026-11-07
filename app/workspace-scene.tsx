'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { bindAmbientMotion } from './ambient-motion';

export type WorkspaceSceneProps = {
  variant: 'overview' | 'analysis' | 'planning' | 'records' | 'terminal';
  sceneKey: string;
  enabled: boolean;
};

type AmbientTrack = { selector: string; frames: Keyframe[]; duration: number; stagger?: number };
const ambientTracks: Record<WorkspaceSceneProps['variant'], AmbientTrack[]> = {
  overview: [{ selector: '.workspace-scene__star-drift', duration: 30000, frames: [
    { transform: 'rotate(0deg)' }, { transform: 'rotate(8deg)', offset: .5 }, { transform: 'rotate(0deg)' },
  ] }],
  analysis: [
    { selector: '.workspace-scene__wave-front', duration: 16000, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(-7px)', offset: .5 }, { transform: 'translateY(0)' }] },
    { selector: '.workspace-scene__wave-back', duration: 22000, frames: [{ transform: 'translateY(0)' }, { transform: 'translateY(6px)', offset: .5 }, { transform: 'translateY(0)' }] },
  ],
  planning: [
    { selector: '.workspace-scene__aurora-front', duration: 18000, frames: [{ transform: 'translate(0, 0)' }, { transform: 'translate(5px, -4px)', offset: .5 }, { transform: 'translate(0, 0)' }] },
    { selector: '.workspace-scene__aurora-back', duration: 24000, frames: [{ transform: 'translate(0, 0)' }, { transform: 'translate(-6px, 3px)', offset: .5 }, { transform: 'translate(0, 0)' }] },
  ],
  records: [{ selector: '.workspace-scene__thread-drift', duration: 20000, frames: [
    { transform: 'scaleY(1)' }, { transform: 'scaleY(1.06)', offset: .5 }, { transform: 'scaleY(1)' },
  ] }],
  terminal: [{ selector: '.workspace-scene__glyph-column', duration: 11000, stagger: 1300, frames: [
    { transform: 'translateY(0)', opacity: 1 },
    { transform: 'translateY(14px)', opacity: 0, offset: .44 },
    { transform: 'translateY(-14px)', opacity: 0, offset: .45 },
    { transform: 'translateY(0)', opacity: 1 },
  ] }],
};

/** Native loops touch only data-free SVG groups. One finite illumination is
 * replaced on each activation; no pointer coordinates, timers or RAF work. */
export function bindWorkspaceScene(scene: HTMLElement, variant: WorkspaceSceneProps['variant'], enabled: boolean,
  entryMemory = { played: false }, onAvailabilityChange: (available: boolean) => void = () => {}) {
  const illumination = scene.querySelector<SVGGElement>('.workspace-scene__illumination');
  const canPulse = typeof illumination?.animate === 'function';
  let active = false;
  let alive = true;
  let pulse: Animation | undefined;
  let ambient: Animation[] = [];
  let pulseFailed = false;
  let ambientFailed = false;
  const cancelPulse = () => { pulse?.cancel(); pulse = undefined; };
  const stop = () => { cancelPulse(); ambient.forEach(animation => animation.cancel()); ambient = []; };
  const illuminate = () => {
    if (!alive || !active || !canPulse || pulseFailed) return;
    cancelPulse();
    try {
      pulse = illumination!.animate([
        { opacity: 0 }, { opacity: 1, offset: .28 }, { opacity: .65, offset: .6 }, { opacity: 0 },
      ], { duration: 760, easing: 'cubic-bezier(.2,.55,.35,1)', iterations: 1 });
    } catch { pulseFailed = true; cancelPulse(); onAvailabilityChange(false); }
  };
  const startAmbient = () => {
    if (ambient.length || ambientFailed) return;
    try {
      for (const track of ambientTracks[variant]) {
        scene.querySelectorAll<SVGElement>(track.selector).forEach((node, index) => {
          if (typeof node.animate !== 'function') return;
          // Ease each leg, so turning points settle rather than reverse at
          // full speed. Positive delays retain the unanimated starting pose.
          ambient.push(node.animate(track.frames.map(frame => ({ easing: 'ease-in-out', ...frame })), {
            duration: track.duration, iterations: Infinity, easing: 'linear', delay: (track.stagger || 0) * index }));
        });
      }
    } catch {
      ambientFailed = true;
      ambient.forEach(animation => animation.cancel()); ambient = [];
    }
  };
  const click = () => {
    if (scene.getAttribute('aria-disabled') !== 'true') illuminate();
  };
  scene.addEventListener('click', click);
  const disposeGate = bindAmbientMotion(scene, enabled, next => {
    active = next;
    if (!next) stop();
    else {
      startAmbient();
      if (!entryMemory.played) { entryMemory.played = true; illuminate(); }
    }
    onAvailabilityChange(next && canPulse && !pulseFailed);
  });
  return () => {
    alive = false;
    disposeGate(); stop();
    scene.removeEventListener('click', click);
  };
}

// These constant forms never consume dates, account data, amounts or status.
const stars = Array.from({ length: 48 }, (_, index) => {
  const step = Math.floor(index / 3), arm = index % 3;
  const angle = arm * Math.PI * 2 / 3 + step * .24;
  const radius = 20 + step * 10;
  return { x: Number((282 + Math.cos(angle) * radius).toFixed(2)), y: Number((122 + Math.sin(angle) * radius * .38).toFixed(2)), r: Number((1.4 + index % 4 * .55).toFixed(2)) };
});
const slices = Array.from({ length: 24 }, (_, index) => ({
  x: 62 + index * 16,
  upper: Number((53 + Math.sin(index * .24) * 29).toFixed(2)),
  lower: Number((116 + Math.sin(index * .24 + .8) * 31).toFixed(2)),
}));
const threads = Array.from({ length: 11 }, (_, index) => {
  const offset = (index - 5) * 20;
  return `M30 ${120 + offset}C132 ${120 + offset * 1.5} 206 122 276 122S382 ${120 - offset * 1.5} 482 ${120 - offset}`;
});
// Fixed decorative binary sequence, consistent with the shared background rain.
const TERMINAL_GLYPHS = '01001101000111010010110100011010110001011001010011100101101';
const glyphColumns = Array.from({ length: 8 }, (_, column) => {
  const x = 90 + column * 45, start = 24 + column % 3 * 12;
  return Array.from({ length: 8 }, (_, row) => ({
    x, y: start + row * 22,
    character: TERMINAL_GLYPHS[(column * 7 + row * 11) % TERMINAL_GLYPHS.length],
    head: row === 7,
  }));
});

type ScenePaint = { warm: string; cool: string; bloom: string };
function Geometry({ variant, paint }: Pick<WorkspaceSceneProps, 'variant'> & { paint: ScenePaint }) {
  const warm = `url(#${paint.warm})`, cool = `url(#${paint.cool})`, bloom = `url(#${paint.bloom})`;
  switch (variant) {
    case 'overview': return <g className="workspace-scene__geometry workspace-scene__starflow" transform="rotate(-14 282 122)">
      <ellipse cx="282" cy="122" rx="172" ry="75" fill={bloom} />
      <path className="workspace-scene__haze" stroke={warm} d="M101 161C139 215 345 195 405 128S329 45 270 90C221 127 266 159 316 137" />
      <path className="workspace-scene__filament" stroke={warm} d="M101 161C139 215 345 195 405 128S329 45 270 90C221 127 266 159 316 137" />
      <path className="workspace-scene__filament workspace-scene__filament--cool" stroke={cool} d="M447 101C410 39 209 42 151 115S219 195 288 151C334 121 293 89 250 111" />
      <g className="workspace-scene__star-drift">{stars.map((star, index) => <circle key={index} cx={star.x} cy={star.y} r={star.r} className={`workspace-scene__star workspace-scene__star--${index % 3}`} />)}</g>
      <ellipse cx="282" cy="122" rx="34" ry="16" fill={bloom} />
      <g className="workspace-scene__illumination"><path d="M101 161C139 215 345 195 405 128S329 45 270 90C221 127 266 159 316 137" /><ellipse cx="282" cy="122" rx="14" ry="6" /></g>
    </g>;
    case 'analysis': return <g className="workspace-scene__geometry workspace-scene__waves" transform="rotate(-11 272 125)">
      <ellipse cx="280" cy="132" rx="190" ry="76" fill={bloom} />
      <g className="workspace-scene__wave-back" fill={cool}>{slices.map(({ x, lower }, index) => <path key={index} d={`M${x + 7} ${lower}h9v52h-9Z`} />)}</g>
      <g className="workspace-scene__wave-front" fill={warm}>{slices.map(({ x, upper }, index) => <path key={index} d={`M${x} ${upper}h9v86h-9Z`} />)}</g>
      <g className="workspace-scene__illumination"><path d="M62 54C184 103 279 19 440 37M62 140C184 189 279 105 440 123" /></g>
    </g>;
    case 'planning': return <g className="workspace-scene__geometry workspace-scene__aurora">
      <ellipse cx="290" cy="125" rx="184" ry="82" fill={bloom} />
      <path fill={cool} className="workspace-scene__aurora-back" d="M28 155C109 165 144 52 237 70S365 174 491 73V111C366 207 303 100 237 103S114 206 28 196Z" />
      <path className="workspace-scene__aurora-front" fill={warm} d="M24 129C131 180 149 30 252 60S365 178 488 100V148C367 219 321 110 251 103S127 230 24 179Z" />
      <path className="workspace-scene__filament" stroke={warm} d="M24 129C131 180 149 30 252 60S365 178 488 100" />
      <path className="workspace-scene__filament workspace-scene__filament--cool" stroke={cool} d="M28 155C109 165 144 52 237 70S365 174 491 73" />
      <g className="workspace-scene__illumination"><path d="M24 129C131 180 149 30 252 60S365 178 488 100" /></g>
    </g>;
    case 'records': return <g className="workspace-scene__geometry workspace-scene__threads">
      <ellipse cx="276" cy="122" rx="118" ry="42" fill={bloom} />
      <g className="workspace-scene__thread-drift">{threads.map((d, index) => <path key={index} d={d} className="workspace-scene__thread" stroke={index % 3 === 0 ? cool : warm} />)}</g>
      <ellipse cx="276" cy="122" rx="26" ry="11" fill={bloom} />
      <g className="workspace-scene__illumination"><path d={threads[2]} /><path d={threads[5]} /><path d={threads[8]} /></g>
    </g>;
    case 'terminal': return <g className="workspace-scene__geometry workspace-scene__terminal">
      {glyphColumns.map((column, index) => <g key={index} className={`workspace-scene__glyph-column workspace-scene__glyph-column--${index % 3}`}>
        {column.map((glyph, row) => <text key={row} x={glyph.x} y={glyph.y} className={glyph.head ? 'workspace-scene__glyph-head' : undefined} opacity={Number((.12 + row * .12).toFixed(2))}>{glyph.character}</text>)}
      </g>)}
      <g className="workspace-scene__illumination">{glyphColumns.filter((_, index) => index % 2 === 0).map((column, index) => <text key={index} x={column[7].x} y={column[7].y}>{column[7].character}</text>)}</g>
    </g>;
  }
}

export function WorkspaceScene({ variant, sceneKey, enabled }: WorkspaceSceneProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [available, setAvailable] = useState(false);
  const entryMemory = useRef({ key: sceneKey, played: false });
  const id = `workspace-scene-${useId().replace(/:/g, '')}`;
  const paint = { warm: `${id}-warm`, cool: `${id}-cool`, bloom: `${id}-bloom` };
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (entryMemory.current.key !== sceneKey) entryMemory.current = { key: sceneKey, played: false };
    let mounted = true;
    const dispose = bindWorkspaceScene(element, variant, enabled, entryMemory.current, next => { if (mounted) setAvailable(next); });
    return () => { mounted = false; dispose(); };
  }, [variant, sceneKey, enabled]);
  return <button type="button" ref={ref} className={`workspace-scene workspace-scene--${variant}`}
    aria-label={enabled && available ? 'Pulse lights' : 'Lights paused'} aria-disabled={!enabled || !available} aria-describedby={`${id}-description`}>
    <svg className="workspace-scene__drawing" aria-hidden="true" viewBox="0 0 480 240" preserveAspectRatio="xMidYMid meet" focusable="false">
      <defs>
        <linearGradient id={paint.warm} x1="0" y1="0" x2="1" y2="1"><stop className="workspace-scene__stop-ember" /><stop className="workspace-scene__stop-magenta" offset=".64" /><stop className="workspace-scene__stop-violet" offset="1" /></linearGradient>
        <linearGradient id={paint.cool} x1="0" y1="0" x2="1" y2="1"><stop className="workspace-scene__stop-cyan" /><stop className="workspace-scene__stop-violet" offset="1" /></linearGradient>
        <radialGradient id={paint.bloom}><stop className="workspace-scene__stop-ivory" /><stop className="workspace-scene__stop-ember" offset=".16" /><stop className="workspace-scene__stop-magenta" offset=".45" /><stop className="workspace-scene__stop-clear" offset="1" /></radialGradient>
      </defs>
      <Geometry variant={variant} paint={paint} />
    </svg>
    <span className="workspace-scene__hint" aria-hidden="true">{enabled && available ? 'Pulse lights' : 'Lights paused'}</span>
    <span id={`${id}-description`} className="workspace-scene__description">{enabled && available
      ? 'Activate to pulse the header artwork.'
      : 'Header lights are still while effects are paused or unavailable.'}</span>
  </button>;
}
