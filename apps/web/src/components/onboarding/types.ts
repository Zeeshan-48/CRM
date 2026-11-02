import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

import type { GoogleCalendarStatus } from "@/lib/api/calendar";
import type { Workflow } from "@/lib/api/workflows";
import type { WhatsAppConfig, WhatsAppTemplate } from "@/lib/api/whatsapp";
import type { User } from "@/types";

/**
 * Everything a task needs to decide whether it applies / is complete, and to
 * configure itself. Add a new live data source here (plus fetch it in the
 * checklist hook) when a future task needs one.
 */
export interface OnboardingContext {
  user: User | null;
  calendar: GoogleCalendarStatus | undefined;
  /** Tenant automations, used to detect an active `lead.created` welcome flow. */
  workflows: Workflow[] | undefined;
  /** WhatsApp BYO connection status, to know if a WA welcome can be sent. */
  whatsapp: WhatsAppConfig | undefined;
  /** Approved WhatsApp templates available for a welcome message. */
  waTemplates: WhatsAppTemplate[] | undefined;
  /** Refetch live data sources after a task is configured. */
  refresh: () => void;
}

export interface OnboardingActionProps {
  ctx: OnboardingContext;
  /** Call after a successful configure so the checklist can advance + animate. */
  onDone: () => void;
}

/**
 * A single setup step. To add one in the future, append an entry to
 * ONBOARDING_TASKS with its own `isApplicable`/`isComplete` predicates and a
 * small `Action` component, nothing else in the checklist needs to change.
 */
export interface OnboardingTask {
  key: string;
  title: string;
  description: string;
  /** Fallback icon shown when `brand` is absent or has no logo. */
  icon: LucideIcon;
  /** Optional brand key (see BrandLogo) to render the real service mark. */
  brand?: string;
  /** Whether this step is relevant for this user/workspace at all. */
  isApplicable: (ctx: OnboardingContext) => boolean;
  /** Whether it's already satisfied (drives the live "don't show again" logic). */
  isComplete: (ctx: OnboardingContext) => boolean;
  /** The inline configure UI shown when the step is expanded. */
  Action: ComponentType<OnboardingActionProps>;
}
