import { useCallback, useEffect, useState } from "react";

const THEME_KEY = "mandate_theme";
export type Theme = "light" | "dark";

/** The page's current theme. An inline script in index.html / demo.html
 *  applies the saved choice before first paint, so this only reads it back
 *  rather than deciding it — avoiding a light flash on dark reloads. */
function currentTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(currentTheme);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Storage unavailable — the toggle still works for this visit.
    }
  }, [theme]);

  const toggle = useCallback(
    () => setTheme((t) => (t === "dark" ? "light" : "dark")),
    [],
  );

  return { theme, toggle };
}
