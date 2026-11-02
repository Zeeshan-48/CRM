// Light/dark theme handling (class strategy). Default is light.
// index.html applies the persisted theme inline before first paint.

import { refreshBrandForTheme } from "@/stores/auth-store";

export type Theme = "light" | "dark";

const STORAGE_KEY = "crm-theme";

export const getTheme = (): Theme =>
  localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";

export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle("dark", theme === "dark");
  localStorage.setItem(STORAGE_KEY, theme);
  // The brand accent's lightness is theme-dependent, re-derive it so it stays
  // visible on the new canvas.
  refreshBrandForTheme();
};

export const initTheme = (): void => {
  applyTheme(getTheme());
};

export const toggleTheme = (): Theme => {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
};
