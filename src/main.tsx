import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { OverlayStackProvider } from './components/chat/OverlayStack';
import { ServiceWorkerUpdater } from './components/ServiceWorkerUpdater';

declare global {
  interface Window {
    // Set by index.html's boot script; flipped true once React renders so the
    // "something didn't load" fallback never appears on a healthy start.
    __mtrackBooted?: () => void;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <OverlayStackProvider>
      <App />
      <ServiceWorkerUpdater />
    </OverlayStackProvider>
  </StrictMode>
);

// The bundle parsed and executed this far, so React is mounting — dismiss the
// boot fallback (see the inline script in index.html).
window.__mtrackBooted?.();
