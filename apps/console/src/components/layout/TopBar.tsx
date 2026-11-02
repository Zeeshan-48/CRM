import { LogOut, Moon, Sun, UserRound } from "lucide-react";
import * as React from "react";
import { Link, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getTheme, toggleTheme, type Theme } from "@/lib/theme";
import { BRAND } from "@/lib/brand";
import { useAuthStore } from "@/stores/auth-store";

export function TopBar() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const clear = useAuthStore((s) => s.clear);
  const [theme, setTheme] = React.useState<Theme>(() => getTheme());

  const handleSignOut = () => {
    clear();
    navigate("/login", { replace: true });
  };

  return (
    <header className="sticky top-0 z-40 h-14 border-b bg-card">
      <div className="flex h-full items-center">
        {/* Brand block, locked to the sidebar column with a matching right border */}
        <Link
          to="/"
          className="flex h-full shrink-0 items-center gap-2.5 px-4 lg:w-60 lg:border-r"
        >
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand font-display text-base font-bold text-brand-foreground">
            {BRAND.initial}
          </span>
          <span className="flex flex-col">
            <span className="font-display text-sm font-bold leading-tight tracking-tight text-foreground">
              {BRAND.name}
            </span>
            <span className="text-[10px] font-medium uppercase leading-tight tracking-wider text-muted-foreground">
              Operator console
            </span>
          </span>
        </Link>

        {/* Right area */}
        <div className="flex flex-1 items-center gap-2 px-4 sm:px-6">
          <span className="hidden h-9 items-center gap-1.5 text-xs font-medium leading-none text-muted-foreground md:inline-flex">
            <span className="size-1.5 shrink-0 rounded-full bg-success" />
            Control plane
          </span>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label="Toggle theme"
              onClick={() => setTheme(toggleTheme())}
            >
              {theme === "dark" ? (
                <Sun className="size-4" />
              ) : (
                <Moon className="size-4" />
              )}
            </Button>

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
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuLabel className="font-normal">
                  <p className="truncate text-sm font-semibold">{user?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {user?.email}
                  </p>
                  <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-brand">
                    {user?.role === "SUPERADMIN" ? "Superadmin" : "Operator"}
                  </p>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => navigate("/profile")}>
                  <UserRound />
                  Profile
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={handleSignOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
