import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

// Flat status label: small type, optionally led by a 6px status dot. No pill,
// no background, no border. The variant colours the text (and the dot).
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium leading-5",
  {
    variants: {
      variant: {
        default: "text-brand",
        secondary: "text-muted-foreground",
        destructive: "text-destructive",
        outline: "text-foreground",
        brand: "text-brand",
        success: "text-success",
        warning: "text-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const DOT_BY_DEFAULT = new Set(["success", "warning", "destructive"]);

interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {
  /** Lead with a 6px status dot. Defaults on for the semantic status variants. */
  dot?: boolean;
}

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  const showDot = dot ?? DOT_BY_DEFAULT.has(variant ?? "default");
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {showDot ? (
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
