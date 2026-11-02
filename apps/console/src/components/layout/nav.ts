import {
  Building2,
  Layers,
  LayoutDashboard,
  ScrollText,
  UserCog,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/** Single source of truth for the operator console left rail. */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Overview",
    items: [{ label: "Dashboard", path: "/", icon: LayoutDashboard }],
  },
  {
    group: "Platform",
    items: [
      { label: "Tenants", path: "/tenants", icon: Building2 },
      { label: "Plans", path: "/plans", icon: Layers },
      { label: "Billing", path: "/billing", icon: Wallet },
    ],
  },
  {
    group: "Console",
    items: [
      { label: "Operators", path: "/operators", icon: UserCog },
      { label: "Audit", path: "/audit", icon: ScrollText },
    ],
  },
];
