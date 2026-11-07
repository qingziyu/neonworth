"use client";

import { useId, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useWorkspacePreferences } from './workspace-preferences';
import './workspace-motion-control.css';

/** One immediate control for the existing browser-local motion preference. */
export function WorkspaceMotionControl({ ready, allowed }: { ready: boolean; allowed: boolean }) {
  const { preferences, savePreferences } = useWorkspacePreferences();
  const [feedback, setFeedback] = useState('');
  const descriptionId = useId();
  const paused = preferences.motion === 'quiet';
  const label = !ready ? 'Motion loading' : !allowed ? 'Motion off' : paused ? 'Resume motion' : 'Pause motion';
  return <div className="workspace-motion-control">
    <button type="button" disabled={!ready} aria-disabled={ready && !allowed || undefined} aria-describedby={descriptionId} onClick={() => {
      if (!ready || !allowed) return;
      const saved = savePreferences({ ...preferences, motion: paused ? 'expressive' : 'quiet' });
      setFeedback(saved ? '' : 'Motion preference applied in this tab. Browser storage is unavailable.');
    }}>
      {paused && allowed ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
      <span>{label}</span>
    </button>
    <span id={descriptionId} className="workspace-motion-control__description">{!ready ? 'Loading your display preference.' : !allowed ? 'Your system or browser preference keeps decorative motion off.' : 'Controls decorative motion across the workspace. Your choice is saved in this browser.'}</span>
    <span className="workspace-motion-control__description" role="status">{feedback}</span>
  </div>;
}
