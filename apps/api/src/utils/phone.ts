// Phone-number normalization to E.164. The CRM is India-first, so a bare
// 10-digit number is assumed to be +91 (override with PHONE_DEFAULT_COUNTRY_CODE).
// Lenient by design: it strips spaces, dashes and brackets and handles 0 / 00 / +
// prefixes. Applied both on save (clean data going forward) and at call time (so
// numbers stored before normalization still dial), so it must never throw.

export const DEFAULT_COUNTRY_CODE =
  (process.env.PHONE_DEFAULT_COUNTRY_CODE || "91").replace(/\D/g, "") || "91";

const E164 = /^\+[1-9]\d{6,14}$/;

export const isE164 = (value: string): boolean => E164.test(value);

// Returns a best-effort E.164 string ("+<digits>"), or "" for empty input.
// Does not guarantee validity for genuinely malformed input, callers that
// require a valid number should still test the result with isE164().
export function normalizePhone(
  raw: string | null | undefined,
  countryCode: string = DEFAULT_COUNTRY_CODE
): string {
  if (raw === null || raw === undefined) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  // Already international.
  if (hadPlus) return `+${digits}`;
  // 00 is the international call prefix (e.g. 0091...).
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;

  const cc = countryCode.replace(/\D/g, "") || "91";
  // Already carries the country code (e.g. 91XXXXXXXXXX) but no +.
  if (digits.startsWith(cc) && digits.length === cc.length + 10) return `+${digits}`;
  // National number, possibly with a trunk 0 (0XXXXXXXXXX).
  const national = digits.replace(/^0+/, "");
  if (national.length === 10) return `+${cc}${national}`;
  // Fallback: best effort. May not be a valid number, the caller validates.
  return `+${digits}`;
}

// Normalize for storage: keeps a falsy input as-is (null/undefined/"") so save
// semantics don't change, and only rewrites a non-empty value.
export function normalizePhoneForStore<T extends string | null | undefined>(
  raw: T
): T | string {
  return raw ? normalizePhone(raw) : raw;
}
