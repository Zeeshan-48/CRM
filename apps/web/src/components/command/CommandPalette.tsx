import { useQuery } from "@tanstack/react-query";
import {
  BookOpen,
  Building2,
  FileText,
  Kanban,
  LifeBuoy,
  Sparkles,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import * as React from "react";
import { useNavigate } from "react-router-dom";

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { NAV_GROUPS, canSee } from "@/components/layout/nav";
import { globalSearch } from "@/lib/api/search";
import type { SearchResultItem } from "@/types";
import { useAuthStore } from "@/stores/auth-store";

const TYPE_LABELS: Record<string, string> = {
  leads: "Leads",
  contacts: "Contacts",
  accounts: "Accounts",
  deals: "Deals",
  tickets: "Tickets",
  kb: "Knowledge Base",
  campaigns: "Campaigns",
  users: "Users",
};

const TYPE_ICONS: Record<string, LucideIcon> = {
  leads: UserPlus,
  contacts: Users,
  accounts: Building2,
  deals: Kanban,
  tickets: LifeBuoy,
  kb: BookOpen,
};

/** Detail routes exist for leads and contacts; other types land on the list. */
const routeForResult = (item: SearchResultItem): string => {
  if (item.route === "leads" || item.route === "contacts") {
    return `/${item.route}/${item.id}`;
  }
  return `/${item.route}`;
};

const labelForType = (type: string): string =>
  TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1);

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAskCopilot: () => void;
}

export function CommandPalette({ open, onOpenChange, onAskCopilot }: CommandPaletteProps) {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [query, setQuery] = React.useState("");
  const debouncedQuery = useDebouncedValue(query, 250);
  const searchTerm = debouncedQuery.trim();

  const { data: results = [], isFetching } = useQuery({
    queryKey: ["global-search", searchTerm],
    queryFn: () => globalSearch(searchTerm),
    enabled: open && searchTerm.length >= 2,
    staleTime: 10_000,
  });

  React.useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  // Manual filtering: server results are already relevant to the query, so
  // cmdk's own matcher is disabled and nav items are filtered here instead.
  const normalized = query.trim().toLowerCase();
  const navItems = NAV_GROUPS.flatMap((group) => group.items)
    .filter((item) => canSee(user, item))
    .filter((item) => !normalized || item.label.toLowerCase().includes(normalized));

  const hasResults = results.some((group) => group.items.length > 0);

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      shouldFilter={false}
      title="Command palette"
      description="Jump to a page, record or ask Copilot"
    >
      <CommandInput
        value={query}
        onValueChange={setQuery}
        placeholder="Search or jump to..."
      />
      <CommandList>
        <CommandEmpty>
          {isFetching ? "Searching..." : "No results found."}
        </CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem value="ask-copilot" onSelect={onAskCopilot}>
            <Sparkles className="text-brand" />
            <span>
              Ask Copilot
              {query.trim() ? (
                <span className="text-muted-foreground"> &ldquo;{query.trim()}&rdquo;</span>
              ) : null}
            </span>
          </CommandItem>
        </CommandGroup>

        {navItems.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading="Navigation">
              {navItems.map((item) => (
                <CommandItem
                  key={item.path}
                  value={`nav-${item.path}`}
                  onSelect={() => go(item.path)}
                >
                  <item.icon />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        {hasResults
          ? results
              .filter((group) => group.items.length > 0)
              .map((group) => {
                const Icon = TYPE_ICONS[group.type] ?? FileText;
                return (
                  <React.Fragment key={group.type}>
                    <CommandSeparator />
                    <CommandGroup heading={labelForType(group.type)}>
                      {group.items.map((item) => (
                        <CommandItem
                          key={`${group.type}-${item.id}`}
                          value={`${group.type}-${item.id}`}
                          onSelect={() => go(routeForResult(item))}
                        >
                          <Icon />
                          <div className="flex min-w-0 flex-col">
                            <span className="truncate">{item.title}</span>
                            {item.sub ? (
                              <span className="truncate text-xs text-muted-foreground">
                                {item.sub}
                              </span>
                            ) : null}
                          </div>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  </React.Fragment>
                );
              })
          : null}
      </CommandList>

      {/* Keyboard-hint footer, mirrors the sectioned, accented profile modal */}
      <div className="flex items-center justify-between gap-2 border-t px-4 py-2.5 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans font-medium leading-none">
              &uarr;&darr;
            </kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="rounded border bg-muted px-1.5 py-0.5 font-sans font-medium leading-none">
              &crarr;
            </kbd>
            open
          </span>
        </div>
        <span className="flex items-center gap-1.5 text-brand">
          <Sparkles className="size-3.5" />
          Powered by Copilot
        </span>
      </div>
    </CommandDialog>
  );
}
