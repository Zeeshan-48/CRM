// Tiny, dependency-free templating for the generic AI-calling adapter:
// {{token}} substitution for URLs/headers (plain) and JSON bodies (escaped),
// plus a dot/bracket path getter for pulling fields out of provider responses.

const TOKEN = /\{\{\s*(\w+)\s*\}\}/g;

// Plain substitution for URLs and header values (not JSON-parsed).
export const fillPlain = (template: string, vars: Record<string, string>): string =>
  template.replace(TOKEN, (_m, key: string) => String(vars[key] ?? ""));

// Substitution for a JSON body template: each placeholder sits inside a JSON
// string, so values are escaped for that context (quotes/backslashes/newlines).
export const fillJsonTemplate = (template: string, vars: Record<string, string>): string =>
  template.replace(TOKEN, (_m, key: string) => JSON.stringify(String(vars[key] ?? "")).slice(1, -1));

// Resolves "a.b.c" / "a.b[0].c" against a parsed JSON object. Returns undefined
// when any segment is missing.
export const getPath = (obj: unknown, path: string | null | undefined): unknown => {
  if (!path) return undefined;
  const parts = path
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .map((p) => p.trim())
    .filter(Boolean);
  let cur: unknown = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[p];
  }
  return cur;
};

// Convenience: a string field at a path, else null.
export const getStringPath = (obj: unknown, path: string | null | undefined): string | null => {
  const v = getPath(obj, path);
  if (v == null) return null;
  return typeof v === "string" ? v : JSON.stringify(v);
};
