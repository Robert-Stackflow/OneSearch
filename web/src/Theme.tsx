import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ThemeProvider } from '@robert-stackflow/oneui/ThemeProvider';
type ColorScheme = 'light' | 'dark' | 'auto';
const key = 'mantine-color-scheme-value'; // Preserve the previous application preference.
function read(): ColorScheme {
  try {
    const value = localStorage.getItem(key);
    return value === 'dark' || value === 'auto' ? value : 'light';
  } catch {
    return 'light';
  }
}
const Context = createContext<{
  colorScheme: ColorScheme;
  setColorScheme(value: ColorScheme): void;
}>({ colorScheme: 'light', setColorScheme: () => {} });
export function Theme({ children }: { children: ReactNode }) {
  const [colorScheme, setScheme] = useState(read);
  function setColorScheme(value: ColorScheme) {
    setScheme(value);
    try {
      localStorage.setItem(key, value);
    } catch {}
  }
  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === key) setScheme(read());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  return (
    <Context value={{ colorScheme, setColorScheme }}>
      <ThemeProvider
        theme="blue"
        mode={colorScheme === 'auto' ? 'system' : colorScheme}
      >
        {children}
      </ThemeProvider>
    </Context>
  );
}
export const useColorScheme = () => useContext(Context);
