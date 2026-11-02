import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  Check,
  ChevronRight,
  LogOut,
  Menu,
  Moon,
  Phone,
  Search,
  Settings,
  Sparkles,
  Sun,
  UserRound,
} from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

import { BRAND } from "@/lib/brand";
import { logout } from "@/lib/api/auth";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api/notifications";
import type { NotificationItem } from "@/types";
import { timeAgo } from "@/lib/format";
import { getTheme, toggleTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/layout/AppShell";
import { SideNavContent } from "@/components/layout/SideNav";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { AvailabilityToggle } from "@/components/telephony/AvailabilityToggle";
import { CallingNumberDialog } from "@/components/telephony/CallingNumberDialog";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Product brand mark: a flat, solid tile in the tenant accent (--brand),
 * carrying a plain typographic initial. Used in the top bar and the mobile
 * nav drawer header.
 */
function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-9 shrink-0 items-center justify-center rounded-md bg-brand text-brand-foreground",
        className,
      )}
    >
      <span className="font-display text-[15px] font-extrabold leading-none tracking-[-0.02em]">
        {BRAND.initial}
      </span>
    </span>
  );
}

/**
 * Product wordmark: the lowercase "open crm." treatment from the login
 * hero, compacted for the top bar, with a spaced uppercase caption beneath.
 */
function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex flex-col leading-none", className)}>
      <span className="font-display text-[19px] font-bold lowercase tracking-[-0.03em] text-foreground">
        {BRAND.wordmark.lead} <span className="text-brand">{BRAND.wordmark.accent}</span>
      </span>
      <span className="mt-1.5 text-[9.5px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
        Customer OS
      </span>
    </span>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { openCopilot, openPalette } = useShell();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [theme, setTheme] = React.useState<Theme>(() => getTheme());
  const [numberDialogOpen, setNumberDialogOpen] = React.useState(false);
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false);

  const { data: notificationData } = useQuery({
    queryKey: ["notifications"],
    queryFn: getNotifications,
    refetchInterval: 30_000,
  });

  const markAllRead = useMutation({
    mutationFn: markAllNotificationsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markOneRead = useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const unread = notificationData?.unread ?? 0;
  const notifications = notificationData?.notifications ?? [];

  const openNotification = (n: NotificationItem) => {
    if (!n.read) markOneRead.mutate(n.id);
    if (n.link) navigate(n.link);
  };

  const handleSignOut = async () => {
    // Record the sign-out (audit trail) while we still hold the token, then drop
    // local state. Best-effort, never let a network/auth error block sign-out.
    try {
      await logout();
    } catch {
      /* ignore, sign out locally regardless */
    }
    clear();
    navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-40 h-14 border-b bg-card">
      <div className="flex h-full items-center">
        {/* Mobile nav trigger, the desktop rail is hidden below lg */}
        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Open navigation menu"
              className="ml-1.5 lg:hidden"
            >
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[17rem] p-0">
            <Link
              to="/dashboard"
              onClick={() => setMobileNavOpen(false)}
              className="flex h-14 shrink-0 items-center gap-2.5 border-b px-4"
            >
              <BrandMark />
              <BrandWordmark />
            </Link>
            <div className="h-[calc(100vh-3.5rem)] overflow-y-auto">
              <SideNavContent onNavigate={() => setMobileNavOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>

        {/* Brand block, locked to the sidebar column with a matching right border */}
        <Link
          to="/dashboard"
          className="flex h-full shrink-0 items-center gap-2.5 px-3 lg:w-60 lg:border-r lg:px-4"
        >
          <BrandMark />
          <BrandWordmark className="hidden sm:flex" />
        </Link>

        {/* Right area */}
        {/* min-w-0: without it this flex child keeps its min-content width,
            the search label is nowrap (truncate), and the row overflows the
            viewport on small screens instead of the label truncating. */}
        <div className="flex min-w-0 flex-1 items-center gap-3 px-4 sm:px-6">
          {user?.tenant?.name ? (
            <span className="hidden h-9 max-w-[200px] items-center gap-2 text-sm font-medium leading-none text-muted-foreground md:inline-flex">
              <span className="size-1.5 shrink-0 rounded-full bg-success" />
              <span className="truncate">{user.tenant.name}</span>
            </span>
          ) : null}

          {/* Global search (opens command palette) */}
          <div className="flex min-w-0 flex-1 justify-center">
            <button
              type="button"
              onClick={openPalette}
              className="flex h-9 w-full max-w-lg items-center gap-2 rounded-md border bg-muted/40 pl-3.5 pr-1.5 text-sm text-muted-foreground transition-colors duration-120 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              <Search className="size-4 shrink-0" />
              <span className="flex-1 truncate text-left">
                Search leads, contacts, deals...
              </span>
              <kbd className="hidden rounded-md border bg-card px-2 py-0.5 font-sans text-[10px] font-medium leading-none text-muted-foreground sm:inline-block">
                &#8984;K
              </kbd>
            </button>
          </div>

          {/* Right cluster */}
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openCopilot}
              aria-label="Copilot"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-foreground transition-colors duration-120 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background"
            >
              <Sparkles className="size-4 text-brand" />
              <span className="hidden sm:inline">Copilot</span>
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  aria-label="Notifications"
                >
                  <Bell className="size-4" />
                  {unread > 0 ? (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold leading-none text-brand-foreground">
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[24rem] p-0">
                <div className="flex items-center justify-between px-3 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">Notifications</span>
                    {unread > 0 ? (
                      <span className="text-[11px] font-semibold text-brand">
                        {unread} new
                      </span>
                    ) : null}
                  </div>
                  {unread > 0 ? (
                    <button
                      type="button"
                      onClick={() => markAllRead.mutate()}
                      className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand/10"
                    >
                      <Check className="size-3.5" />
                      Mark all read
                    </button>
                  ) : null}
                </div>
                <DropdownMenuSeparator className="my-0" />
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center gap-1.5 px-4 py-12 text-center">
                    <span className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted">
                      <Bell className="size-5 text-muted-foreground" />
                    </span>
                    <p className="text-sm font-medium text-foreground">
                      You're all caught up
                    </p>
                    <p className="text-xs text-muted-foreground">
                      New notifications will show up here.
                    </p>
                  </div>
                ) : (
                  <div className="max-h-[26rem] overflow-y-auto p-1.5">
                    {notifications.slice(0, 15).map((n) => (
                      <DropdownMenuItem
                        key={n.id}
                        className={cn(
                          "flex cursor-pointer items-start gap-2.5 rounded-md px-2.5 py-2.5",
                          !n.read && "bg-brand/5 focus:bg-brand/10",
                        )}
                        onSelect={() => openNotification(n)}
                      >
                        <span
                          className={cn(
                            "mt-1.5 size-2 shrink-0 rounded-full",
                            n.read ? "bg-transparent" : "bg-brand",
                          )}
                          aria-hidden
                        />
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              "line-clamp-2 text-sm leading-snug",
                              n.read
                                ? "text-muted-foreground"
                                : "font-medium text-foreground",
                            )}
                          >
                            {n.text}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {timeAgo(n.created_at)}
                          </p>
                        </div>
                        {n.link ? (
                          <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                        ) : null}
                      </DropdownMenuItem>
                    ))}
                    {notifications.length > 15 ? (
                      <p className="px-2.5 py-2 text-center text-xs text-muted-foreground">
                        Showing 15 of {notifications.length}
                      </p>
                    ) : null}
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-md p-1 transition-colors duration-120 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background sm:pr-3"
                  aria-label="Account menu"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                    <UserRound className="size-4" />
                  </span>
                  <span className="hidden max-w-[140px] truncate text-sm font-medium leading-none text-foreground sm:block">
                    {user?.name ?? "Account"}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72 p-0">
                {/* Identity header, larger avatar, name, email and role badge */}
                <DropdownMenuLabel className="p-0 font-normal">
                  <div className="flex items-center gap-3 px-3 py-3.5">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand/10 text-brand">
                      <UserRound className="size-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold leading-tight text-foreground">
                        {user?.name ?? "Account"}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {user?.email}
                      </p>
                    </div>
                    {user?.role ? (
                      <span className="shrink-0 self-start text-[10px] font-semibold uppercase tracking-wide text-brand">
                        {user.role}
                      </span>
                    ) : null}
                  </div>
                  {user?.tenant?.name ? (
                    <div className="flex items-center gap-1.5 px-3 pb-3 text-xs text-muted-foreground">
                      <span className="size-1.5 shrink-0 rounded-full bg-brand" />
                      <span className="truncate">{user.tenant.name}</span>
                    </div>
                  ) : null}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="my-0" />

                {/* Account */}
                <div className="p-1.5">
                  <DropdownMenuItem
                    className="gap-2.5 rounded-md px-2.5 py-2"
                    onSelect={() => navigate("/profile")}
                  >
                    <UserRound className="text-muted-foreground" />
                    My profile
                  </DropdownMenuItem>
                  {user?.role === "ADMIN" ? (
                    <DropdownMenuItem
                      className="gap-2.5 rounded-md px-2.5 py-2"
                      onSelect={() => navigate("/settings")}
                    >
                      <Settings className="text-muted-foreground" />
                      Settings
                    </DropdownMenuItem>
                  ) : null}
                </div>
                <DropdownMenuSeparator className="my-0" />

                {/* Preferences */}
                <div className="p-1.5">
                  <DropdownMenuItem
                    className="gap-2.5 rounded-md px-2.5 py-2"
                    onSelect={(event) => {
                      event.preventDefault();
                      setTheme(toggleTheme());
                    }}
                  >
                    {theme === "dark" ? (
                      <Moon className="text-muted-foreground" />
                    ) : (
                      <Sun className="text-muted-foreground" />
                    )}
                    Appearance
                    <span className="ml-auto text-xs capitalize text-muted-foreground">
                      {theme === "dark" ? "Dark" : "Light"}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="gap-2.5 rounded-md px-2.5 py-2"
                    onSelect={(event) => {
                      event.preventDefault();
                      setNumberDialogOpen(true);
                    }}
                  >
                    <Phone className="text-muted-foreground" />
                    Calling number
                  </DropdownMenuItem>
                  <AvailabilityToggle />
                </div>
                <DropdownMenuSeparator className="my-0" />

                {/* Session */}
                <div className="p-1.5">
                  <DropdownMenuItem
                    className="gap-2.5 rounded-md px-2.5 py-2 text-destructive focus:bg-destructive/10 focus:text-destructive"
                    onSelect={handleSignOut}
                  >
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </div>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
      <CallingNumberDialog
        open={numberDialogOpen}
        onOpenChange={setNumberDialogOpen}
      />
    </header>
  );
}
