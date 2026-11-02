// Product brand for the default (non white-labelled) experience. Tenants
// white-label their own name and accent colour from Settings; everything else
// that says the product name reads it from here, so a fork rebrands in one file.

export const BRAND = {
  /** Product name shown in the UI. */
  name: "Open CRM",
  /** Lowercase wordmark pieces: "open" + accent "crm." */
  wordmark: { lead: "open", accent: "crm." },
  /** One-letter mark used in the square logo tile. */
  initial: "O",
  /** Default accent (magenta, hue 322) when a tenant has no brand colour. */
  defaultColor: "#b6207f",
  /** Name used for the platform-provided (shared) provider accounts. */
  platformName: "Open CRM platform",
  poweredBy: "Powered by Open CRM",
  assistantName: "Open CRM assistant",
} as const;
