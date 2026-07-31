import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ConfirmProvider } from './components/ui/ConfirmDialog';
import { applyPublicRuntimeConfig, resolvePublicRuntimeConfig } from './lib/config/appConfig';
import { applyTheme, getInitialTheme } from './lib/theme';
import './index.css';

applyPublicRuntimeConfig(resolvePublicRuntimeConfig(import.meta.env));
applyTheme(getInitialTheme());

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfirmProvider>
      <App />
    </ConfirmProvider>
  </StrictMode>
);
