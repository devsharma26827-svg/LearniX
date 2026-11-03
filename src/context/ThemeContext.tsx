import React, { createContext, useContext, useEffect, useState, useCallback } from "react";

export type Theme = "light" | "dark";

interface ThemeContextType {
  theme: Theme;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

export const THEME_STORAGE_KEY = "learnix-theme";
export const LEGACY_THEME_STORAGE_KEY = "edupulse-theme";

const getInitialTheme = (): Theme => {
  try {
    const stored =
      localStorage.getItem(THEME_STORAGE_KEY) ||
      localStorage.getItem(LEGACY_THEME_STORAGE_KEY) ||
      localStorage.getItem("theme");

    if (stored === "light" || stored === "dark") {
      return stored;
    }

    if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      return "dark";
    }
  } catch (e) {
    console.warn("Theme storage read warning:", e);
  }
  return "light";
};

const applyThemeToDOM = (activeTheme: Theme) => {
  const root = document.documentElement;
  const body = document.body;

  if (activeTheme === "dark") {
    root.classList.add("dark");
    root.setAttribute("data-theme", "dark");
    if (body) {
      body.classList.add("dark");
      body.setAttribute("data-theme", "dark");
    }
  } else {
    root.classList.remove("dark");
    root.setAttribute("data-theme", "light");
    if (body) {
      body.classList.remove("dark");
      body.setAttribute("data-theme", "light");
    }
  }

  try {
    localStorage.setItem(THEME_STORAGE_KEY, activeTheme);
    localStorage.setItem(LEGACY_THEME_STORAGE_KEY, activeTheme);
  } catch (e) {
    console.warn("Theme storage write warning:", e);
  }
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  // Synchronize DOM immediately on mount and on every theme change
  useEffect(() => {
    applyThemeToDOM(theme);
  }, [theme]);

  // Listen to OS system color scheme changes if user hasn't explicitly set a preference
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleSystemThemeChange = (e: MediaQueryListEvent) => {
      try {
        const stored =
          localStorage.getItem(THEME_STORAGE_KEY) ||
          localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
        if (!stored) {
          const nextTheme: Theme = e.matches ? "dark" : "light";
          setThemeState(nextTheme);
          applyThemeToDOM(nextTheme);
        }
      } catch {}
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, []);

  // Listen to storage events across browser tabs/windows
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === THEME_STORAGE_KEY || e.key === LEGACY_THEME_STORAGE_KEY || e.key === "theme") {
        if (e.newValue === "light" || e.newValue === "dark") {
          setThemeState(e.newValue);
          applyThemeToDOM(e.newValue);
        }
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: Theme = prev === "dark" ? "light" : "dark";
      applyThemeToDOM(next);
      return next;
    });
  }, []);

  const setTheme = useCallback((newTheme: Theme) => {
    applyThemeToDOM(newTheme);
    setThemeState(newTheme);
  }, []);

  const isDark = theme === "dark";

  return (
    <ThemeContext.Provider
      value={{
        theme,
        isDark,
        toggleTheme,
        setTheme,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
