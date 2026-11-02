import { create } from "zustand";
import { persist } from "zustand/middleware";

import { BRAND } from "@/lib/brand";
import type { User } from "@/types";

const hexToRgb = (hex: string): [number, number, number] | null => {
  const value = hex.trim().replace(/^#/, "");
  const expanded =
    value.length === 3
      ? value
          .split("")
          .map((c) => c + c)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(expanded)) return null;
  const n = parseInt(expanded, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** Default accent: the Open CRM magenta (see BRAND.defaultColor). */
const DEFAULT_BRAND_RGB: [number, number, number] = hexToRgb(BRAND.defaultColor) ?? [182, 32, 127];

const rgbToHsl = (
  r: number,
  g: number,
  b: number,
): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
};

const hslToRgb = (
  h: number,
  s: number,
  l: number,
): [number, number, number] => {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
};

const luminance = ([r, g, b]: [number, number, number]): number => {
  const c = [r, g, b].map((v) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

const contrast = (a: [number, number, number], b: [number, number, number]): number => {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
};

// Canvas colours the accent must read against (card surfaces, the worst case).
const LIGHT_CANVAS: [number, number, number] = [255, 255, 255];
const DARK_CANVAS: [number, number, number] = hslToRgb(206 / 360, 0.26, 0.09);

// Fit a tenant brand colour to the active theme while keeping its hue: on the
// light theme darken it until it reaches 4.5:1 against white (it doubles as
// text and as a fill under white labels); on the dark theme lighten it until
// it reaches 4.5:1 against the dark surfaces (dark ink sits on it there).
const adjustForTheme = (
  rgb: [number, number, number],
  isDark: boolean,
): string => {
  const [h, s0, l0] = rgbToHsl(rgb[0], rgb[1], rgb[2]);
  const canvas = isDark ? DARK_CANVAS : LIGHT_CANVAS;
  let s = isDark ? s0 * 0.85 : s0;
  let l = isDark ? Math.max(l0, 0.6) : l0;
  if (isDark) s = Math.min(s, 0.75);
  let out = hslToRgb(h, s, l);
  for (let i = 0; i < 40 && contrast(out, canvas) < 4.5; i++) {
    l = isDark ? Math.min(l + 0.02, 0.95) : Math.max(l - 0.02, 0.05);
    out = hslToRgb(h, s, l);
  }
  return `${out[0]} ${out[1]} ${out[2]}`;
};

// The last-applied tenant brand, kept so a theme switch can re-derive the
// theme-appropriate tint without re-fetching the user.
let currentBrandRgb: [number, number, number] = DEFAULT_BRAND_RGB;

const paintBrand = (): void => {
  const isDark = document.documentElement.classList.contains("dark");
  document.documentElement.style.setProperty(
    "--brand",
    adjustForTheme(currentBrandRgb, isDark),
  );
};

/**
 * Writes the tenant brand colour onto :root as an RGB triplet, auto-adjusted
 * for the active light/dark theme so the accent stays visible. Every brand/
 * primary/ring Tailwind utility resolves against this variable, so the whole
 * UI re-tints per tenant. Passing null/undefined restores the default accent.
 */
export const applyBrandColor = (hex?: string | null): void => {
  currentBrandRgb = (hex ? hexToRgb(hex) : null) ?? DEFAULT_BRAND_RGB;
  paintBrand();
};

/** Re-derive the brand tint for the current theme (call after a theme switch). */
export const refreshBrandForTheme = (): void => paintBrand();

interface AuthState {
  token: string | null;
  user: User | null;
  setAuth: (token: string, user: User) => void;
  patchUser: (partial: Partial<User>) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => {
        applyBrandColor(user.tenant?.brand_color);
        set({ token, user });
      },
      patchUser: (partial) =>
        set((s) => (s.user ? { user: { ...s.user, ...partial } } : s)),
      clear: () => {
        applyBrandColor(null);
        set({ token: null, user: null });
      },
    }),
    {
      name: "crm-auth",
      onRehydrateStorage: () => (state) => {
        // Re-apply the persisted tenant's brand colour on hard refresh.
        applyBrandColor(state?.user?.tenant?.brand_color ?? null);
      },
    },
  ),
);

/** True when the user may access a module ("*" grants everything). */
export const hasModule = (
  user: User | null | undefined,
  key: string,
): boolean => {
  if (!user || !Array.isArray(user.modules)) return false;
  return user.modules.includes("*") || user.modules.includes(key);
};
