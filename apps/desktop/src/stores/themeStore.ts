import { create } from 'zustand';
import type { AppSettings } from '@ipm/shared';

type ThemeMode = 'system' | 'dark' | 'light';

interface ThemeState {
  theme: ThemeMode;
  resolvedDark: boolean;
  setTheme: (theme: ThemeMode) => void;
  initializeTheme: (initial?: ThemeMode) => void;
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'system',
  resolvedDark: true,

  setTheme: (theme: ThemeMode) => {
    let isDark = false;
    if (theme === 'system') {
      isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } else {
      isDark = theme === 'dark';
    }

    if (isDark) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    set({ theme, resolvedDark: isDark });

    if (window.api && window.api.updateSettings) {
      window.api.updateSettings({ theme }).catch(console.error);
    }
  },

  initializeTheme: (initial?: ThemeMode) => {
    const selected = initial || get().theme;
    get().setTheme(selected);

    // Listen to OS system color-scheme changes
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', (e) => {
      if (get().theme === 'system') {
        if (e.matches) {
          document.documentElement.classList.add('dark');
        } else {
          document.documentElement.classList.remove('dark');
        }
        set({ resolvedDark: e.matches });
      }
    });
  },
}));
