import {
  BarChart3,
  Bot,
  Building2,
  CalendarDays,
  CheckSquare,
  CreditCard,
  Headset,
  Inbox,
  Kanban,
  LayoutDashboard,
  LifeBuoy,
  ListTodo,
  Mail,
  MailCheck,
  Megaphone,
  MessageCircle,
  Package,
  BookOpen,
  Plug,
  Radar,
  Settings,
  ShieldCheck,
  TrendingUp,
  UserCog,
  UserPlus,
  Users,
  Wallet,
  Workflow,
  type LucideIcon,
} from "lucide-react";

import { hasModule } from "@/stores/auth-store";
import type { User } from "@/types";

export interface NavItem {
  label: string;
  path: string;
  icon: LucideIcon;
  /** Module key gating this item; hidden when the user lacks it. */
  module?: string;
  /** Roles allowed to see this item; hidden for everyone else. */
  roles?: string[];
}

export interface NavGroup {
  group: string;
  items: NavItem[];
}

/**
 * Single source of truth for the left rail and the command palette
 * navigation entries. Items with a module key are hidden when the signed-in
 * user is not entitled; items with roles are hidden for other roles.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    group: "Workspace",
    items: [
      { label: "Dashboard", path: "/dashboard", icon: LayoutDashboard },
      { label: "My Work", path: "/reminders", icon: CheckSquare },
    ],
  },
  {
    group: "Sales",
    items: [
      { label: "Leads", path: "/leads", icon: UserPlus, module: "leads" },
      { label: "Contacts", path: "/contacts", icon: Users, module: "contacts" },
      { label: "Accounts", path: "/accounts", icon: Building2, module: "accounts" },
      { label: "Pipeline", path: "/pipeline", icon: Kanban, module: "deals" },
      { label: "Activities", path: "/activities", icon: ListTodo, module: "activities" },
      // Product integration: the catalog an agent pitches from, and the feed
      // of people showing buying intent inside a connected product.
      { label: "Products", path: "/products", icon: Package, module: "products" },
      { label: "Signals", path: "/signals", icon: Radar, module: "products" },
      { label: "Calendar", path: "/calendar", icon: CalendarDays, module: "calendar" },
    ],
  },
  {
    group: "Conversations",
    items: [
      // The inbox split by channel, each opens the two-way conversation view
      // scoped to one channel (was a single "Inbox" with an in-page channel rail).
      { label: "WhatsApp", path: "/inbox/whatsapp", icon: MessageCircle, module: "inbox" },
      { label: "Email", path: "/inbox/email", icon: Inbox, module: "inbox" },
      { label: "Compose Email", path: "/email", icon: Mail, module: "email" },
    ],
  },
  {
    group: "Marketing",
    items: [
      { label: "Campaigns", path: "/campaigns", icon: Megaphone, module: "campaigns" },
    ],
  },
  {
    group: "Service",
    items: [
      { label: "Tickets", path: "/tickets", icon: LifeBuoy, module: "tickets" },
      { label: "Knowledge Base", path: "/kb", icon: BookOpen, module: "kb" },
    ],
  },
  {
    group: "Automation",
    items: [
      { label: "Workflows", path: "/workflows", icon: Workflow, module: "workflows" },
      { label: "AI Agents", path: "/agents", icon: Bot, module: "agents" },
      { label: "Sales Agent", path: "/sales-agent", icon: TrendingUp, module: "agents" },
    ],
  },
  {
    group: "Insights",
    items: [
      { label: "Analytics", path: "/analytics", icon: BarChart3, module: "analytics" },
      { label: "Finance", path: "/finance", icon: Wallet, module: "finance" },
    ],
  },
  {
    // Communication-channel provider setup (connect / configure how the CRM
    // sends and receives messages and calls).
    // Provider/BYO setup is workspace administration, not day-to-day agent
    // work, restricted to owners and managers (matched by the route guards in
    // routes.tsx). The `whatsapp`/`voice` modules that agents hold grant the
    // operational features (send, call), NOT this configuration surface.
    group: "Channels",
    items: [
      { label: "Email Sending", path: "/email-sending", icon: MailCheck, module: "channels" },
      { label: "WhatsApp", path: "/whatsapp", icon: MessageCircle, module: "channels" },
      { label: "Telephony", path: "/telephony", icon: Headset, module: "channels" },
    ],
  },
  {
    // Workspace governance + account administration.
    group: "Administration",
    items: [
      { label: "Users & Roles", path: "/users", icon: UserCog, module: "team" },
      { label: "Integrations & API", path: "/integrations", icon: Plug, module: "integrations" },
      { label: "Billing", path: "/billing", icon: CreditCard, module: "billing" },
      { label: "Audit & Compliance", path: "/audit", icon: ShieldCheck, module: "audit" },
      { label: "Settings", path: "/settings", icon: Settings, module: "settings" },
    ],
  },
];

/** True when the user may see this nav item (role gate, then module gate). */
export const canSee = (user: User | null | undefined, item: NavItem): boolean => {
  if (!user) return false;
  if (item.roles && !item.roles.includes(user.role)) return false;
  if (item.module && !hasModule(user, item.module)) return false;
  return true;
};

/** Nav groups filtered for one user; empty groups are dropped. */
export const visibleNavGroups = (user: User | null | undefined): NavGroup[] =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => canSee(user, item)),
  })).filter((group) => group.items.length > 0);
