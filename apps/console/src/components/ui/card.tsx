import * as React from "react";

import { cn } from "@/lib/utils";

// Flat section: one subtle hairline border, no shadow. Nest content directly
// inside; avoid bordered boxes within a Card (use hairline dividers instead).
function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("rounded-lg border bg-card text-card-foreground", className)}
      {...props}
    />
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("flex flex-col gap-1 p-5", className)} {...props} />;
}

function CardTitle({ className, children, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn("font-display text-[15px] font-semibold leading-tight tracking-tight", className)}
      {...props}
    >
      {children}
    </h3>
  );
}

function CardDescription({ className, ...props }: React.ComponentProps<"p">) {
  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("p-5 pt-0", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex items-center border-t px-5 py-4", className)} {...props} />
  );
}

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
