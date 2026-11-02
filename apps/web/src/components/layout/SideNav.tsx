import { NavLink } from "react-router-dom";

import { visibleNavGroups } from "@/components/layout/nav";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

/**
 * The nav groups themselves, shared by the desktop rail (SideNav) and the
 * mobile drawer in TopBar. `onNavigate` lets the drawer close on selection.
 *
 * Styling intentionally leans on the neutral app palette (foreground / accent /
 * muted / border) rather than the tenant `--brand` colour, so the chrome stays
 * consistent across every workspace.
 */
export function SideNavContent({ onNavigate }: { onNavigate?: () => void }) {
  const user = useAuthStore((s) => s.user);
  const groups = visibleNavGroups(user);

  return (
    <nav className="flex flex-col px-3 py-4">
      {groups.map((group, groupIndex) => (
        <div
          key={group.group}
          className={cn(groupIndex > 0 && "mt-4 border-t border-border/60 pt-4")}
        >
          <p className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            {group.group}
          </p>
          <ul className="space-y-0.5">
            {group.items.map((item) => (
              <li key={item.path}>
                <NavLink
                  to={item.path}
                  end={item.path === "/"}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "group relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-all duration-300 ease-out",
                      isActive
                        ? "bg-accent font-medium text-foreground"
                        : "text-foreground/70 hover:bg-muted/60 hover:text-foreground",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon
                        className={cn(
                          "size-4 shrink-0 transition-colors duration-300 ease-out",
                          isActive
                            ? "text-foreground"
                            : "text-muted-foreground group-hover:text-foreground",
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export function SideNav() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r border-border bg-card lg:block">
      <SideNavContent />
    </aside>
  );
}
