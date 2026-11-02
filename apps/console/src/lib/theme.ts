// Theme handling for the operator console. DARK is the default control-room
// look; light mode is an optional toggle applied via the `.light` class.
// index.html applies the persisted choice inline before first paint.

export type Theme = "dark" | "light";

const STORAGE_KEY = "operator-theme";
export const THEME_CHANGE_EVENT = "operator-theme-change";

export const getTheme = (): Theme =>
  localStorage.getItem(STORAGE_KEY) === "light" ? "light" : "dark";

export const applyTheme = (theme: Theme): void => {
  document.documentElement.classList.toggle("light", theme === "light");
  localStorage.setItem(STORAGE_KEY, theme);
  window.dispatchEvent(new CustomEvent<Theme>(THEME_CHANGE_EVENT, { detail: theme }));
};

export const initTheme = (): void => {
  applyTheme(getTheme());
};

export const toggleTheme = (): Theme => {
  const next: Theme = getTheme() === "dark" ? "light" : "dark";
  applyTheme(next);
  return next;
};
