import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MantineProvider, createTheme } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
const theme = createTheme({
  respectReducedMotion: true,
  primaryColor: 'victoria',
  colors: {
    victoria: [
      '#edf1fb',
      '#dce4f7',
      '#bdcbee',
      '#98ace0',
      '#718bd1',
      '#526dc0',
      '#4059aa',
      '#354b91',
      '#2c3f78',
      '#25355f',
    ],
    dark: [
      '#e9edf5',
      '#c8d0e0',
      '#a4b0c5',
      '#7c8ba4',
      '#526078',
      '#344057',
      '#242e40',
      '#1b2332',
      '#141b27',
      '#0d131d',
    ],
  },
  fontFamily:
    'Inter, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  defaultRadius: 'md',
  headings: { fontWeight: '650' },
  components: {
    Pagination: {
      defaultProps: {
        className: 'moment-pagination',
        size: 'sm',
        getControlProps: (control: string) => ({
          'aria-label': (
            {
              next: '下一页',
              previous: '上一页',
              first: '第一页',
              last: '最后一页',
            } as Record<string, string>
          )[control],
        }),
      },
    },
    ScrollArea: { defaultProps: { scrollbarSize: 8 } },
    PasswordInput: {
      defaultProps: {
        visibilityToggleButtonProps: { 'aria-label': '显示或隐藏密码' },
      },
    },
    SegmentedControl: {
      defaultProps: {
        className: 'moment-segment',
        transitionDuration: 190,
        transitionTimingFunction: 'cubic-bezier(.2,.7,.2,1)',
      },
    },
    Button: { defaultProps: { radius: 10 } },
    Paper: { defaultProps: { radius: 16 } },
    Input: { defaultProps: { radius: 10 } },
    Modal: {
      defaultProps: { overlayProps: { backgroundOpacity: 0.35, blur: 4 } },
    },
    CloseButton: { defaultProps: { 'aria-label': '关闭' } },
  },
});
const cache = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false, staleTime: 3000 },
  },
});
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light">
      <Notifications position="top-right" />
      <QueryClientProvider client={cache}>
        <App />
      </QueryClientProvider>
    </MantineProvider>
  </StrictMode>,
);
