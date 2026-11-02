import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// The tenant's brand colour is injected at runtime as an RGB triplet on
// :root (--brand), so every brand/primary utility re-tints per tenant.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // Named easing so components can use `ease-spring` instead of an arbitrary
      // `ease-[cubic-bezier(...)]` value (whose commas trip Tailwind's scanner).
      transitionTimingFunction: {
        spring: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "rgb(var(--brand) / <alpha-value>)",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        brand: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          foreground: "rgb(var(--brand-foreground) / <alpha-value>)",
        },
        primary: {
          DEFAULT: "rgb(var(--brand) / <alpha-value>)",
          foreground: "rgb(var(--brand-foreground) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Tokenized semantic status colours (RGB triplets so /alpha tints work).
        // Light/dark values are tuned in index.css.
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        neutral: "rgb(var(--neutral) / <alpha-value>)",
      },
      // One flat radius (6px) for every surface and control; only avatars and
      // status dots stay round (rounded-full).
      borderRadius: {
        "3xl": "var(--radius)",
        "2xl": "var(--radius)",
        xl: "var(--radius)",
        lg: "var(--radius)",
        md: "var(--radius)",
        sm: "calc(var(--radius) - 2px)",
      },
      // Flat by default: small shadows are off; only floating overlays
      // (popovers, dialogs) keep a faint lift.
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-lg)",
        "2xl": "var(--shadow-lg)",
      },
      fontFamily: {
        sans: ["'Geist Variable'", "'Inter Variable'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Geist Variable'", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'Geist Mono Variable'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      transitionDuration: {
        "120": "120ms",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
