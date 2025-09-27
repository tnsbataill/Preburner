import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import './index.css';

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

if (import.meta.env.PROD) {
  void import('virtual:preburner-sw-register').then(({ registerPreburnerServiceWorker }) => {
    registerPreburnerServiceWorker();
  });
}
