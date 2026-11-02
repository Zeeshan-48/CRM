import { useQuery } from "@tanstack/react-query";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  PartyPopper,
  Sparkles,
} from "lucide-react";
import * as React from "react";

import { BRAND } from "@/lib/brand";
import { getGoogleCalendarStatus } from "@/lib/api/calendar";
import { listWorkflows } from "@/lib/api/workflows";
import { getWhatsAppConfig, listWaTemplates } from "@/lib/api/whatsapp";
import { cn } from "@/lib/utils";
import { hasModule, useAuthStore } from "@/stores/auth-store";
import { BrandLogo, hasBrandLogo } from "@/components/brand/BrandLogo";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";

import { ONBOARDING_TASKS } from "./tasks";
import type { OnboardingContext } from "./types";

const SWIPE_RATIO = 0.18; // fraction of width to trigger a slide change

// "Don't show again" is a per-user, persistent opt-out kept in localStorage
// (keyed by user id so a different account on the same browser still sees it).
// Unlike the session-only "later" dismiss, this survives refreshes and logins.
const hideKey = (userId: string) => `crm:onboarding:hidden:${userId}`;
const isOnboardingHidden = (userId?: string) => {
  if (!userId) return false;
  try {
    return localStorage.getItem(hideKey(userId)) === "1";
  } catch {
    return false;
  }
};
const setOnboardingHidden = (userId?: string) => {
  if (!userId) return;
  try {
    localStorage.setItem(hideKey(userId), "1");
  } catch {
    /* storage unavailable (private mode / quota), silently no-op */
  }
};

// "I'll set this up later" / closing the modal. Held in sessionStorage rather
// than component state so a refresh (or landing on another page via a deep
// link) doesn't re-open the modal the user just dismissed, it stays closed
// for the rest of the browser session, and returns on the next fresh visit.
const snoozeKey = (userId: string) => `crm:onboarding:snoozed:${userId}`;
const isOnboardingSnoozed = (userId?: string) => {
  if (!userId) return false;
  try {
    return sessionStorage.getItem(snoozeKey(userId)) === "1";
  } catch {
    return false;
  }
};
const setOnboardingSnoozed = (userId?: string) => {
  if (!userId) return;
  try {
    sessionStorage.setItem(snoozeKey(userId), "1");
  } catch {
    /* storage unavailable (private mode / quota), silently no-op */
  }
};

/**
 * Post-login setup wizard. Shows a premium, swipeable one-step-at-a-time
 * checklist whenever the current user still has pending setup steps
 * (today: phone number + Google Calendar).
 *
 * Source of truth is LIVE data, not a dismissed flag, it disappears the moment
 * every step is configured and reappears on its own if one is later removed. It
 * re-opens on each fresh app load while anything is pending; the user can close
 * it for the current session.
 *
 * Mounted once in AppShell. To add a step, extend ONBOARDING_TASKS.
 */
export function OnboardingChecklist() {
  const user = useAuthStore((s) => s.user);

  const calendarQuery = useQuery({
    queryKey: ["google-calendar-status"],
    queryFn: getGoogleCalendarStatus,
    staleTime: 60_000,
    enabled: !!user,
  });

  // The welcome-workflow step is only relevant to users who can manage
  // automations; skip its data fetches entirely for everyone else.
  const canManageWorkflows = hasModule(user, "workflows");
  const workflowsQuery = useQuery({
    queryKey: ["workflows"],
    queryFn: listWorkflows,
    staleTime: 60_000,
    enabled: !!user && canManageWorkflows,
  });
  const whatsappQuery = useQuery({
    queryKey: ["whatsapp-config"],
    queryFn: getWhatsAppConfig,
    staleTime: 60_000,
    enabled: !!user && canManageWorkflows,
  });
  const waTemplatesQuery = useQuery({
    queryKey: ["wa-templates"],
    queryFn: listWaTemplates,
    staleTime: 60_000,
    enabled: !!user && canManageWorkflows,
  });

  const ctx: OnboardingContext = {
    user,
    calendar: calendarQuery.data,
    workflows: workflowsQuery.data,
    whatsapp: whatsappQuery.data,
    waTemplates: waTemplatesQuery.data,
    refresh: () => {
      void calendarQuery.refetch();
      void workflowsQuery.refetch();
      void whatsappQuery.refetch();
      void waTemplatesQuery.refetch();
    },
  };

  const slides = ONBOARDING_TASKS.filter((t) => t.isApplicable(ctx));
  const pendingCount = slides.filter((t) => !t.isComplete(ctx)).length;
  // Wait for the workflow list too (when applicable) so the welcome step doesn't
  // flash as pending before its live state loads.
  const ready =
    !!user &&
    !calendarQuery.isLoading &&
    (!canManageWorkflows || !workflowsQuery.isLoading);

  const [open, setOpen] = React.useState(false);
  const [dismissed, setDismissed] = React.useState(() =>
    isOnboardingSnoozed(user?.id),
  );
  // Permanent, persisted opt-out ("Don't show again"). Seeded from localStorage
  // once the user id is known so a returning user is never re-prompted.
  const [suppressed, setSuppressed] = React.useState(() =>
    isOnboardingHidden(user?.id),
  );
  React.useEffect(() => {
    setSuppressed(isOnboardingHidden(user?.id));
    // Both flags are seeded from storage once the user id resolves: on the
    // first render it is still undefined, so the initializers above read
    // nothing and would otherwise re-open a dismissed modal.
    setDismissed(isOnboardingSnoozed(user?.id));
  }, [user?.id]);
  const [index, setIndex] = React.useState(0);

  // Swipe / drag state.
  const trackRef = React.useRef<HTMLDivElement>(null);
  const drag = React.useRef({ startX: 0, active: false, width: 1 });
  const [dragX, setDragX] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  const total = slides.length;
  const firstPending = React.useMemo(
    () => slides.findIndex((t) => !t.isComplete(ctx)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, pendingCount],
  );

  // Open once per app load when setup is incomplete, and land on the first
  // still-pending step.
  React.useEffect(() => {
    if (ready && pendingCount > 0 && !dismissed && !suppressed) {
      setOpen(true);
      setIndex(firstPending === -1 ? 0 : firstPending);
    }
  }, [ready, pendingCount, dismissed, suppressed, firstPending]);

  if (!ready) return null;

  const allDone = pendingCount === 0;

  const goTo = (i: number) => setIndex(Math.max(0, Math.min(total - 1, i)));

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) {
      setDismissed(true);
      setOnboardingSnoozed(user?.id);
    }
  };

  // Persist the opt-out, then close: this modal won't auto-open again for this
  // user on any future refresh or login (setup stays reachable from Settings).
  const dontShowAgain = () => {
    setOnboardingHidden(user?.id);
    setSuppressed(true);
    setDismissed(true);
    setOpen(false);
  };

  // Don't start a drag from an interactive control (input, button, link).
  const fromInteractive = (target: EventTarget | null) =>
    target instanceof Element &&
    !!target.closest("input, button, textarea, a, [role='button']");

  const onPointerDown = (e: React.PointerEvent) => {
    if (total < 2 || fromInteractive(e.target)) return;
    drag.current = {
      startX: e.clientX,
      active: true,
      width: trackRef.current?.offsetWidth ?? 1,
    };
    setDragging(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current.active) return;
    let dx = e.clientX - drag.current.startX;
    // Rubber-band resistance at the edges.
    if ((index === 0 && dx > 0) || (index === total - 1 && dx < 0)) dx *= 0.35;
    setDragX(dx);
  };

  const endDrag = () => {
    if (!drag.current.active) return;
    const threshold = drag.current.width * SWIPE_RATIO;
    if (dragX <= -threshold) goTo(index + 1);
    else if (dragX >= threshold) goTo(index - 1);
    drag.current.active = false;
    setDragging(false);
    setDragX(0);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-[36rem]">
        {/* Screen-reader label for the dialog itself. The visible heading below is
            an <h2> inside the scrolling body and swaps to "All set" when every
            step is done, so Radix cannot use it, without these, every page load
            logged "DialogContent requires a DialogTitle" and the modal opened
            unannounced for anyone using a screen reader. */}
        <DialogTitle className="sr-only">Finish setting up your workspace</DialogTitle>
        <DialogDescription className="sr-only">
          A few quick steps to get your workspace ready.
        </DialogDescription>
        {allDone ? (
          <AllSet onClose={() => handleOpenChange(false)} />
        ) : (
          <>
            {/* Header band */}
            <div className="px-6 pb-5 pt-7">
              <div className="mb-3 inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-brand">
                <Sparkles className="size-3" />
                Quick setup
              </div>
              <h2 className="text-lg font-semibold tracking-tight">
                Finish setting up your workspace
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                A few quick steps to get your workspace ready.
              </p>

              {/* Segmented progress */}
              <div className="mt-5 flex items-center gap-1.5">
                {slides.map((t, i) => {
                  const complete = t.isComplete(ctx);
                  return (
                    <button
                      key={t.key}
                      type="button"
                      aria-label={`Go to ${t.title}`}
                      onClick={() => goTo(i)}
                      className={cn(
                        "h-1.5 flex-1 rounded-full transition-all duration-300",
                        complete
                          ? "bg-success"
                          : i === index
                            ? "bg-slate-300 dark:bg-slate-600"
                            : "bg-muted",
                      )}
                    />
                  );
                })}
              </div>
            </div>

            {/* Swipeable region: the arrows are real flex columns flanking the
                content, so they always keep their own padding and can never sit
                on top of, or get clipped against, the content. */}
            <div className="flex items-center gap-2 px-3">
              <button
                type="button"
                aria-label="Previous step"
                onClick={() => goTo(index - 1)}
                disabled={total < 2 || index === 0}
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronLeft className="size-4" />
              </button>

              {/* Horizontal clip for the slide track. */}
              <div
                className="min-w-0 flex-1 overflow-hidden"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onPointerLeave={endDrag}
              >
              <div
                ref={trackRef}
                className="flex items-stretch"
                style={{
                  transform: `translateX(calc(${-index * 100}% + ${dragX}px))`,
                  transition: dragging
                    ? "none"
                    : "transform 420ms cubic-bezier(0.16, 1, 0.3, 1)",
                  touchAction: "pan-y",
                }}
              >
                {slides.map((task) => {
                  const complete = task.isComplete(ctx);
                  const Icon = task.icon;
                  const useBrand = !!task.brand && hasBrandLogo(task.brand);
                  return (
                    <div
                      key={task.key}
                      className="flex h-[31rem] max-h-[82vh] w-full shrink-0 select-none overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [&_input]:select-auto"
                    >
                      {/* m-auto centers the content, but still lets it scroll
                          from the top when a step is taller than the frame. */}
                      <div className="m-auto flex w-full flex-col items-center gap-7 px-4 py-8 text-center">
                      <div className="flex flex-col items-center gap-3">
                        <div className="relative inline-flex">
                          {useBrand ? (
                            <BrandLogo brand={task.brand!} size={76} />
                          ) : (
                            <span className="flex size-[76px] items-center justify-center rounded-2xl bg-brand text-brand-foreground">
                              <Icon className="size-8" />
                            </span>
                          )}
                          {complete ? (
                            <span className="absolute -bottom-1 -right-1 flex size-6 items-center justify-center rounded-full border-2 border-card bg-success text-white animate-in zoom-in-50">
                              <Check className="size-3.5" strokeWidth={3} />
                            </span>
                          ) : null}
                        </div>

                        <div>
                          <h3 className="text-base font-semibold">
                            {task.title}
                          </h3>
                          <p className="mx-auto mt-1 max-w-[19rem] text-sm text-muted-foreground">
                            {task.description}
                          </p>
                        </div>
                      </div>

                      <div className="w-full max-w-[23rem]">
                        {complete ? (
                          <div className="flex items-center justify-center gap-2 rounded-xl border border-success/30 bg-success/5 py-3 text-sm font-medium text-success">
                            <Check className="size-4" strokeWidth={2.5} />
                            All done
                          </div>
                        ) : (
                          <task.Action
                            ctx={ctx}
                            onDone={() => goTo(index + 1)}
                          />
                        )}
                      </div>
                      </div>
                    </div>
                  );
                })}
              </div>
              </div>

              <button
                type="button"
                aria-label="Next step"
                onClick={() => goTo(index + 1)}
                disabled={total < 2 || index === total - 1}
                className="flex size-10 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition hover:bg-accent disabled:pointer-events-none disabled:opacity-30"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>

            {/* Skip, session dismiss, or a persistent opt-out */}
            <div className="flex items-center justify-center gap-3 pb-6 pt-3">
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                I&apos;ll set this up later
              </button>
              <span aria-hidden className="text-muted-foreground">
                &middot;
              </span>
              <button
                type="button"
                onClick={dontShowAgain}
                className="text-xs font-medium text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
              >
                Don&apos;t show again
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AllSet({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col items-center px-8 pb-8 pt-10 text-center animate-in fade-in zoom-in-95">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-success">
        <PartyPopper className="size-7 text-white" />
      </div>
      <h2 className="mt-5 text-lg font-semibold tracking-tight">
        You&apos;re all set
      </h2>
      <p className="mt-1.5 max-w-[18rem] text-sm text-muted-foreground">
        Your workspace is ready to go. You can update these anytime from
        Settings.
      </p>
      <Button className="mt-6 h-11 w-full max-w-[16rem]" onClick={onClose}>
        Start using {BRAND.name}
      </Button>
    </div>
  );
}
