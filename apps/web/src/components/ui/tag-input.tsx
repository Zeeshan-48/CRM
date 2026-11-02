import { X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  /** Optional id of a <datalist> to surface suggestions while typing. */
  listId?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A simple chip/tag editor. Type a value and press Enter or comma to add it;
 * Backspace on an empty field removes the last chip. Values are de-duplicated
 * case-insensitively and trimmed. Kept intentionally lightweight, no async,
 * no external deps beyond the shared UI kit.
 */
export function TagInput({
  value,
  onChange,
  placeholder,
  listId,
  disabled,
  className,
}: TagInputProps) {
  const [draft, setDraft] = React.useState("");

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) return;
    const exists = value.some((v) => v.toLowerCase() === tag.toLowerCase());
    if (!exists) onChange([...value, tag]);
    setDraft("");
  };

  const removeTag = (tag: string) => onChange(value.filter((v) => v !== tag));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTag(draft);
    } else if (event.key === "Backspace" && !draft && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2 py-1.5 text-sm transition-colors duration-120 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 ring-offset-background",
        disabled && "cursor-not-allowed opacity-50",
        className
      )}
    >
      {value.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-1 text-xs font-medium text-brand"
        >
          {tag}
          {!disabled ? (
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="text-brand/70 transition-colors hover:text-brand"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          ) : null}
        </span>
      ))}
      <input
        value={draft}
        list={listId}
        disabled={disabled}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => addTag(draft)}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="h-6 min-w-[6rem] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
      />
    </div>
  );
}
