// useTheme — light is the default per visual-spec.md §2.5 + design-reference.md.
// Persisted under localStorage 'optcgsandbox.theme'. Settings UI is deferred for
// v0.1; toggle from devtools via window.__setTheme('dark') for testing.

import { useEffect, useState, useCallback } from 'react';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'optcgsandbox.theme';

function readInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'light';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Private-mode storage exceptions — fall through.
  }
  // Default is LIGHT regardless of system preference, per spec.
  // Owner intent: cream paper on first launch.
  return 'light';
}

function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.documentElement.setAttribute('data-theme', theme);
}

export function useTheme(): {
  theme: Theme;
  setTheme: (next: Theme) => void;
  toggleTheme: () => void;
} {
  const [theme, setThemeState] = useState<Theme>(readInitialTheme);

  useEffect(() => {
    applyTheme(theme);
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Ignore quota / private mode.
    }
    // Expose a dev-console hook for testing without a settings UI yet.
    (window as unknown as { __setTheme?: (t: Theme) => void }).__setTheme = setThemeState;
  }, [theme]);

  const setTheme = useCallback((next: Theme) => setThemeState(next), []);
  const toggleTheme = useCallback(
    () => setThemeState((t) => (t === 'light' ? 'dark' : 'light')),
    [],
  );

  return { theme, setTheme, toggleTheme };
}
