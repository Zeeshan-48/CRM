import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.terraform/**",
      "**/dist-scripts/**",
      "**/.local-storage/**",
      "**/playwright-report/**",
      "apps/api/src/db/types.ts",
      "apps/web/**",
      "apps/console/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "warn",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
    },
  },
  {
    // Kysely rows and jsonb documents cross the API's repository boundary untyped in
    // places, so `any` is allowed there (apps/api lints itself with its own config too).
    files: ["apps/api/**"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
  {
    files: ["apps/api/tests/**", "apps/api/scripts/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["scripts/**", "db/**", "e2e/**", "**/*.config.*"],
    rules: { "no-console": "off" },
  }
);
