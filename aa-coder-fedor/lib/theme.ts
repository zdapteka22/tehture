export type FedorTheme = "light" | "dark";

export const THEME_KEY = "fedor-theme";

export function loadTheme(): FedorTheme {
  if (typeof window === "undefined") return "dark";
  try {
    const raw = String(window.localStorage.getItem(THEME_KEY) || window.localStorage.getItem("theme") || "")
      .trim()
      .toLowerCase();
    return raw === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

export function applyTheme(theme: FedorTheme): FedorTheme {
  const next: FedorTheme = theme === "light" ? "light" : "dark";
  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.classList.toggle("light", next === "light");
    root.classList.toggle("dark", next === "dark");
    root.setAttribute("data-theme", next);
    if (document.body) {
      document.body.classList.toggle("light", next === "light");
      document.body.classList.toggle("dark", next === "dark");
    }
  }
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(THEME_KEY, next);
      window.localStorage.setItem("theme", next);
    } catch {
      // ignore quota
    }
  }
  return next;
}
