import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

// Operator console theming: true-black DARK palette by default (tokens on
// :root), with a refined light mode applied via the `.light` class. The brand
// accent is the fixed Open CRM magenta (hue 322; no per-tenant re-tinting).
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
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
        success: "rgb(var(--success) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
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
      fontFamily: {
        sans: ["'Geist Variable'", "'Inter Variable'", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["'Geist Variable'", "'Inter Variable'", "ui-sans-serif", "sans-serif"],
        mono: ["'Geist Mono Variable'", "ui-monospace", "SFMono-Regular", "monospace"],
      },
      boxShadow: {
        // Flat by default: small shadows are off; only overlays keep a lift.
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        xl: "var(--shadow-lg)",
        "2xl": "var(--shadow-lg)",
      },
      transitionDuration: {
        "120": "120ms",
      },
      transitionTimingFunction: {
        out: "cubic-bezier(0.16, 1, 0.3, 1)",
        standard: "cubic-bezier(0.4, 0, 0.2, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.16, 1, 0.3, 1) both",
        shimmer: "shimmer 2.2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [animate],
} satisfies Config;
