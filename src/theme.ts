import { useEffect, useState } from "react";

export type ThemePref = "system" | "light" | "dark";

function read(): ThemePref {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemePref>(read);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset.theme;
    else root.dataset.theme = theme;
    try {
      if (theme === "system") localStorage.removeItem("theme");
      else localStorage.setItem("theme", theme);
    } catch {
      /* 存储不可用时忽略 */
    }
  }, [theme]);

  const toggle = () => setTheme((t) => (t === "system" ? "light" : t === "light" ? "dark" : "system"));
  return { theme, toggle };
}
