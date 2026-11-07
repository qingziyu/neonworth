import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import { WorkspacePreferencesProvider } from '../app/workspace-preferences';
import { WorkspaceBackground } from '../app/workspace-background';
import { WORKSPACE_PREFERENCES_KEY, LEGACY_WORKSPACE_PREFERENCES_KEY } from '../lib/workspace-preferences';
import '../app/globals.css';
import '../app/cyberpunk.css';
import '../app/workspace.css';
import '../app/workspace-effects.css';
import '../app/experience.css';
import '../app/expressive-dynamics.css';
import '../app/warm-neon.css';
import '../app/chart-bars.css';
import './demo.css';
import { DEMO_BASE } from './navigation';

function resetView() {
  try {
    for (const key of [WORKSPACE_PREFERENCES_KEY, LEGACY_WORKSPACE_PREFERENCES_KEY, 'neonworth-hide']) localStorage.removeItem(key);
  } catch { /* The demo also works when browser preference storage is blocked. */ }
  window.location.assign(DEMO_BASE);
}
function DemoBanner() {
  return <div className="demo-banner" role="region" aria-label="Synthetic demonstration">
      <div><strong>Interactive demo</strong><span>Invented data. Explore reports and filters; imports and saves are disabled.</span></div>
      <button type="button" onClick={resetView}>Reset view</button>
    </div>;
}
function Demo() {
  return <WorkspacePreferencesProvider>
    <WorkspaceBackground/>
    <Home workspaceNotice={<DemoBanner/>}/>
  </WorkspacePreferencesProvider>;
}
createRoot(document.getElementById('root')!).render(<StrictMode><Demo/></StrictMode>);
