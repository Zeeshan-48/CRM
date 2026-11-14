// Product brand for the default (non white-labelled) experience. Tenants
// white-label their own name and accent colour from Settings; everything else
// that says the product name reads it from here, so a fork rebrands in one file.

export const BRAND = {
  /** Product name shown in the UI. */
  name: "Bn Orbit",
  /** Lowercase wordmark pieces: "bn" + accent "orbit." */
  wordmark: { lead: "bn", accent: "orbit." },
  /** One-letter mark used in the square logo tile. */
  initial: "B",
  /** Default accent (magenta, hue 322) when a tenant has no brand colour. */
  defaultColor: "#b6207f",
  /** Name used for the platform-provided (shared) provider accounts. */
  platformName: "Bn Orbit platform",
  poweredBy: "Powered by Bn Orbit",
  assistantName: "Bn Orbit assistant",
} as const;
