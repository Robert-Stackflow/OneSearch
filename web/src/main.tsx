import '@robert-stackflow/oneui/styles/base.css';
import '@robert-stackflow/oneui/styles/themes.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@robert-stackflow/oneui/ToastProvider';
import { Theme } from './Theme';
import { toaster } from './toaster';
import App from './App';
const cache = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 3000 },
  },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Theme>
      <ToastProvider controller={toaster}>
        <QueryClientProvider client={cache}>
          <App />
        </QueryClientProvider>
      </ToastProvider>
    </Theme>
  </StrictMode>,
);
