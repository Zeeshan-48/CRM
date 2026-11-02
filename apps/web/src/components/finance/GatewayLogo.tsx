import razorpayLogo from "@/assets/brands/razorpay.svg";
import stripeLogo from "@/assets/brands/stripe.svg";
import type { GatewayName } from "@/lib/api/finance";
import { cn } from "@/lib/utils";

/**
 * Official Razorpay / Stripe brand marks rendered as consistent app-icon tiles.
 * Stripe ships as a rounded brand square already; the Razorpay mark is bare, so
 * it's seated on a clean white tile so the two match in size and shape.
 */
export function GatewayLogo({
  name,
  size = 40,
  className,
}: {
  name: GatewayName;
  size?: number;
  className?: string;
}) {
  if (name === "Stripe") {
    return (
      <img
        src={stripeLogo}
        alt="Stripe"
        width={size}
        height={size}
        draggable={false}
        className={cn("shrink-0", className)}
      />
    );
  }
  return (
    <span
      style={{ width: size, height: size, borderRadius: size * 0.22 }}
      className={cn(
        "flex shrink-0 items-center justify-center border bg-white",
        className,
      )}
    >
      <img
        src={razorpayLogo}
        alt="Razorpay"
        style={{ width: size * 0.6, height: size * 0.6 }}
        draggable={false}
      />
    </span>
  );
}
