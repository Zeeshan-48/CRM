import { NavLink } from "react-router-dom";

import { NAV_GROUPS } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

export function SideNav() {
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-60 shrink-0 overflow-y-auto border-r bg-card lg:block">
      <nav className="flex flex-col gap-5 px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.group}>
            <p className="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.group}
            </p>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.path}>
                  <NavLink
                    to={item.path}
                    end={item.path === "/"}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors duration-120",
                        isActive
                          ? "bg-accent font-medium text-foreground"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}
