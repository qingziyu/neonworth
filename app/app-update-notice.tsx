"use client";

import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { APP_VERSION, appVersionChanged, readAppVersion } from '@/lib/app-version';
import './app-update-notice.css';

/** Updates are explicit: neither polling nor a deployment discards open drafts. */
export function AppUpdateNotice({ blocked }: { blocked: boolean }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let disposed = false;
    let active: AbortController | null = null;
    const check = async () => {
      if (disposed || active || document.visibilityState !== 'visible') return;
      const controller = new AbortController();
      active = controller;
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      try {
        const version = await readAppVersion(controller.signal);
        if (!disposed && version) setAvailable(appVersionChanged(APP_VERSION, version));
      } finally {
        window.clearTimeout(timeout);
        active = null;
      }
    };
    const visible = () => { if (document.visibilityState === 'visible') void check(); };
    void check();
    window.addEventListener('focus', visible);
    window.addEventListener('pageshow', visible);
    document.addEventListener('visibilitychange', visible);
    const interval = window.setInterval(visible, 60_000);
    return () => {
      disposed = true;
      active?.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', visible);
      window.removeEventListener('pageshow', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, []);
  if (!available) return null;
  return <div className="notice app-update-notice" role="status">
    <RefreshCw size={16} aria-hidden="true" />
    <span>A website update is ready. {blocked ? 'After saving or closing edits, return to Overview to load the update.' : 'Load the latest version to use the updated reports and reconciliation.'}</span>
    <button type="button" className="button light" disabled={blocked} onClick={() => { if (!blocked) window.location.reload(); }}>Load latest version</button>
  </div>;
}
