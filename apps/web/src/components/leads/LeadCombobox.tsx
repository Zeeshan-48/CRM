import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { searchLeadOptions } from "@/lib/api/email";
import type { LeadOption } from "@/lib/api/lead-options";
import { cn } from "@/lib/utils";

/**
 * Searchable lead picker backed by server-side search, so it finds any lead by
 * name or email instead of being capped at the first page. The parent holds the
 * selected lead object so the trigger keeps showing it even when it's not in the
 * current (search-filtered) result set.
 */
export function LeadCombobox({
  value,
  onChange,
  placeholder = "Search and pick a lead...",
  triggerClassName,
  disabled,
}: {
  value: LeadOption | null;
  onChange: (lead: LeadOption) => void;
  placeholder?: string;
  triggerClassName?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [debouncedQ, setDebouncedQ] = React.useState("");

  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const leadsQuery = useQuery({
    queryKey: ["lead-search", debouncedQ],
    queryFn: () => searchLeadOptions(debouncedQ),
    enabled: open,
    // Keep the previous results on screen while the next search loads so the
    // list doesn't flicker to empty on every keystroke.
    placeholderData: (prev) => prev,
  });
  const leads = leadsQuery.data ?? [];
  const listboxId = React.useId();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground",
            triggerClassName,
          )}
        >
          <span className="truncate">{value ? value.name : placeholder}</span>
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={listboxId}
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        {/* cmdk's built-in filter is disabled, the server already returns the
            matches for the typed query. */}
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search by name or email..."
            value={q}
            onValueChange={setQ}
          />
          <CommandList>
            <CommandEmpty>
              {leadsQuery.isFetching ? "Searching…" : "No leads found."}
            </CommandEmpty>
            <CommandGroup>
              {leads.map((lead) => (
                <CommandItem
                  key={lead.id}
                  value={lead.id}
                  onSelect={() => {
                    onChange(lead);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0",
                      value?.id === lead.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate">{lead.name}</p>
                    {lead.email ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {lead.email}
                      </p>
                    ) : null}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
