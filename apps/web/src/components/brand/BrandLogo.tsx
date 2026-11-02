import geminiLogo from "@/assets/brands/gemini.svg";
import gmailLogo from "@/assets/brands/gmail.svg";
import gcalLogo from "@/assets/brands/google-calendar.svg";
import razorpayLogo from "@/assets/brands/razorpay.svg";
import stripeLogo from "@/assets/brands/stripe.svg";
import twilioLogo from "@/assets/brands/twilio.svg";
import whatsappLogo from "@/assets/brands/whatsapp.svg";
import { cn } from "@/lib/utils";

/**
 * Official brand marks for the external services we integrate with. Keyed by
 * both the integration `key` used across the app and a few friendly aliases so
 * callers can pass whichever they have on hand.
 */
export const BRAND_SRC: Record<string, string> = {
  whatsapp: whatsappLogo,
  email: gmailLogo,
  gmail: gmailLogo,
  razorpay: razorpayLogo,
  stripe: stripeLogo,
  google_calendar: gcalLogo,
  google: gcalLogo,
  platform_llm: geminiLogo,
  gemini: geminiLogo,
  telephony: twilioLogo,
  twilio: twilioLogo,
};

export function hasBrandLogo(brand: string): boolean {
  return brand in BRAND_SRC;
}

/** Bare logo image (transparent), for inline use next to text. */
export function BrandLogo({
  brand,
  size = 20,
  className,
}: {
  brand: string;
  size?: number;
  className?: string;
}) {
  const src = BRAND_SRC[brand];
  if (!src) return null;
  return (
    <img
      src={src}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      className={cn("shrink-0 object-contain", className)}
    />
  );
}

/**
 * Logo seated on a consistent white rounded tile, the app-icon chip used in
 * connection lists so every brand reads at the same size and shape.
 */
export function BrandTile({
  brand,
  size = 36,
  className,
}: {
  brand: string;
  size?: number;
  className?: string;
}) {
  const src = BRAND_SRC[brand];
  if (!src) return null;
  return (
    <span
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
      className={cn(
        "flex shrink-0 items-center justify-center border bg-white",
        className,
      )}
    >
      <img
        src={src}
        alt=""
        aria-hidden
        draggable={false}
        style={{ width: size * 0.64, height: size * 0.64 }}
        className="object-contain"
      />
    </span>
  );
}
