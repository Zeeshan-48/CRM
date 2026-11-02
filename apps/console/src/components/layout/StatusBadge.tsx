import { cn } from "@/lib/utils";

// Status labels in the console's green/amber/red status-dot language: a 6px
// dot and the status as plain small type. No pill.
const STATUS_STYLES: Record<string, { dot: string; text: string }> = {
  ACTIVE: { dot: "bg-success", text: "text-success" },
  SUSPENDED: { dot: "bg-warning", text: "text-warning" },
  CLOSED: { dot: "bg-destructive", text: "text-destructive" },
  DISABLED: { dot: "bg-destructive", text: "text-destructive" },
  PENDING: { dot: "bg-warning", text: "text-warning" },
};

interface StatusBadgeProps {
  status: string;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const style = STATUS_STYLES[status] ?? {
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap text-xs font-medium",
        style.text,
        className
      )}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", style.dot)} />
      {status}
    </span>
  );
}
