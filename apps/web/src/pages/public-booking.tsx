import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Globe,
  ShieldCheck,
  UserRound,
  Video,
} from "lucide-react";
import * as React from "react";
import { useParams } from "react-router-dom";

import {
  getPublicBooking,
  submitPublicBooking,
} from "@/lib/api/public-booking";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

// Slot times render in the HOST's timezone (the availability was computed there).
const slotTime = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

const longWhen = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: tz,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(iso));

// The slot dates are the HOST's local calendar dates ("YYYY-MM-DD"), so we
// anchor at noon UTC and format in UTC to keep the label timezone-stable.
const noonUTC = (date: string) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};

// "Friday, August 7"
const dayHeading = (date: string): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(noonUTC(date));

const monthLabel = (y: number, m: number): string =>
  new Intl.DateTimeFormat(undefined, {
    timeZone: "UTC",
    month: "long",
    year: "numeric",
  }).format(new Date(Date.UTC(y, m - 1, 1, 12)));

const ymd = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("") || "•";

const WEEKDAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * Month calendar for the dark-blue panel. Only days that carry availability are
 * selectable; the rest are dimmed. Prev/next step through months, bounded to the
 * window that actually has slots.
 */
function MonthCalendar({
  availableDates,
  selectedDate,
  onSelect,
  minDate,
  maxDate,
}: {
  availableDates: Set<string>;
  selectedDate: string | null;
  onSelect: (date: string) => void;
  minDate: string;
  maxDate: string;
}) {
  const [initY, initM] = (selectedDate ?? minDate).split("-").map(Number);
  const [view, setView] = React.useState({ y: initY, m: initM });

  const [minY, minM] = minDate.split("-").map(Number);
  const [maxY, maxM] = maxDate.split("-").map(Number);
  const canPrev = view.y > minY || (view.y === minY && view.m > minM);
  const canNext = view.y < maxY || (view.y === maxY && view.m < maxM);

  const firstWeekday = new Date(Date.UTC(view.y, view.m - 1, 1, 12)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(view.y, view.m, 0, 12)).getUTCDate();
  const cells: (number | null)[] = [
    ...Array<null>(firstWeekday).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const step = (delta: number) =>
    setView((v) => {
      const idx = v.y * 12 + (v.m - 1) + delta;
      return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
    });

  return (
    <div className="relative">
      <div className="flex items-center justify-between">
        <p className="font-display text-lg font-semibold tracking-tight">
          {monthLabel(view.y, view.m)}
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label="Previous month"
            disabled={!canPrev}
            onClick={() => step(-1)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            disabled={!canNext}
            onClick={() => step(1)}
            className="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-25"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-y-1.5">
        {WEEKDAYS.map((d) => (
          <div
            key={d}
            className="pb-1 text-center text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b-${i}`} />;
          const ds = ymd(view.y, view.m, day);
          const available = availableDates.has(ds);
          const selected = ds === selectedDate;
          return (
            <div key={ds} className="flex justify-center py-0.5">
              <button
                type="button"
                disabled={!available}
                onClick={() => onSelect(ds)}
                className={cn(
                  "flex h-9 w-11 items-center justify-center rounded-md text-sm tabular-nums transition-colors",
                  selected
                    ? "bg-brand font-semibold text-brand-foreground"
                    : available
                      ? "font-medium text-foreground hover:bg-muted"
                      : "cursor-default text-muted-foreground",
                )}
              >
                {day}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// One meeting-detail row on the details panel.
function MetaRow({
  icon: Icon,
  children,
}: {
  icon: typeof Clock;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-3 text-sm text-foreground">
      <Icon className="size-4 shrink-0 text-brand" />
      <span>{children}</span>
    </li>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-2xl border bg-card p-10 text-center">
        {children}
      </div>
    </div>
  );
}

export default function PublicBookingPage() {
  const { tenantSlug = "", linkSlug = "" } = useParams();

  const query = useQuery({
    queryKey: ["public-booking", tenantSlug, linkSlug],
    queryFn: () => getPublicBooking(tenantSlug, linkSlug),
    retry: false,
  });
  const info = query.data;

  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = React.useState<string | null>(null);
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [confirmed, setConfirmed] = React.useState<{ start_at: string } | null>(
    null,
  );

  React.useEffect(() => {
    if (!info) return;
    document.title = `Book ${info.link.name} · ${info.tenant.name}`;
    setSelectedDate((cur) => cur ?? info.days[0]?.date ?? null);
    if (info.prefill) {
      setName((cur) => cur || info.prefill!.name);
      setEmail((cur) => cur || info.prefill!.email);
    }
  }, [info]);

  const bookMutation = useMutation({
    mutationFn: () =>
      submitPublicBooking(tenantSlug, linkSlug, {
        name: name.trim(),
        email: email.trim(),
        startAt: selectedSlot as string,
      }),
    onSuccess: (res) => setConfirmed({ start_at: res.start_at }),
  });

  if (query.isLoading) {
    return (
      <CenteredCard>
        <Spinner
          size="lg"
          className="mx-auto text-brand"
          label="Loading booking page"
        />
      </CenteredCard>
    );
  }

  if (query.isError || !info) {
    return (
      <CenteredCard>
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CalendarDays className="size-6" />
        </div>
        <h1 className="mt-4 font-display text-lg font-semibold">
          Booking page not found
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This scheduling link is invalid or is no longer active.
        </p>
      </CenteredCard>
    );
  }

  const availableDates = new Set(info.days.map((d) => d.date));
  const now = new Date();
  const todayYMD = ymd(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const minDate = info.days[0]?.date ?? todayYMD;
  const maxDate = info.days[info.days.length - 1]?.date ?? todayYMD;
  const dayData = info.days.find((d) => d.date === selectedDate);

  const handleSelectDate = (date: string) => {
    setSelectedDate(date);
    setSelectedSlot(null);
    bookMutation.reset();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:py-12">
      <div className="w-full max-w-4xl">
        <div className="reveal grid overflow-hidden rounded-lg border bg-card lg:grid-cols-2">
          {/* Left: tenant brand + calendar */}
          <div className="relative border-b p-7 sm:p-9 lg:border-b-0 lg:border-r">

            {/* Brand lockup */}
            <div className="relative flex items-center gap-2.5">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-brand text-sm font-bold text-brand-foreground">
                {initials(info.tenant.name)}
              </span>
              <span className="truncate text-sm font-bold uppercase tracking-[0.22em]">
                {info.tenant.name}
              </span>
            </div>

            {/* Heading */}
            <p className="relative mt-7 text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              You're booking
            </p>
            <h1 className="relative mt-2 font-display text-[1.7rem] font-semibold leading-[1.12] tracking-tight sm:text-[1.9rem]">
              {info.link.name}
            </h1>
            {info.host ? (
              <p className="relative mt-2.5 flex items-center gap-2 text-sm text-muted-foreground">
                <UserRound className="size-4 opacity-70" />
                with {info.host}
              </p>
            ) : null}

            {/* Calendar */}
            <div className="relative mt-7">
              <MonthCalendar
                availableDates={availableDates}
                selectedDate={selectedDate}
                onSelect={confirmed ? () => {} : handleSelectDate}
                minDate={minDate}
                maxDate={maxDate}
              />
            </div>

            <div className="relative mt-8 flex items-center gap-2 text-[11px] text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Secure scheduling · {BRAND.poweredBy}
            </div>
          </div>

          {/* Right: details + step content */}
          <div className="flex min-h-[30rem] flex-col p-7 sm:p-9">
            {/* Meeting details */}
            <ul className="space-y-2.5">
              <MetaRow icon={Clock}>{info.link.duration_min} minute meeting</MetaRow>
              <MetaRow icon={Video}>Video call, link emailed on booking</MetaRow>
              <MetaRow icon={Globe}>{info.timezone.replace(/_/g, " ")}</MetaRow>
            </ul>
            <div className="mt-5 h-px w-full bg-border" />

            {confirmed ? (
              /* ---- Success ---- */
              <div className="mt-6 flex flex-1 flex-col items-center justify-center text-center">
                <Check className="size-9 text-success" aria-hidden />
                <h2 className="mt-5 font-display text-xl font-semibold tracking-tight">
                  You're booked!
                </h2>
                <div className="mt-4 w-full max-w-xs border-y py-3">
                  <p className="text-sm font-medium">
                    {longWhen(confirmed.start_at, info.timezone)}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {info.link.duration_min} min ·{" "}
                    {info.timezone.replace(/_/g, " ")}
                  </p>
                </div>
                <p className="mt-5 text-sm text-muted-foreground">
                  A calendar invite with the video link is on its way to{" "}
                  <span className="font-medium text-foreground">{email}</span>.
                </p>
              </div>
            ) : selectedSlot ? (
              /* ---- Details form ---- */
              <div className="mt-6 flex flex-1 flex-col">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedSlot(null);
                    bookMutation.reset();
                  }}
                  className="-ml-1 flex w-fit items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                >
                  <ChevronLeft className="size-4" />
                  Back to times
                </button>

                <h2 className="mt-4 font-display text-lg font-semibold tracking-tight">
                  Confirm your details
                </h2>
                <div className="mt-3 flex items-start gap-3 border-y py-3">
                  <CalendarDays className="mt-0.5 size-[18px] shrink-0 text-brand" aria-hidden />
                  <div className="text-sm">
                    <p className="font-medium">
                      {longWhen(selectedSlot, info.timezone)}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {info.link.duration_min} min ·{" "}
                      {info.timezone.replace(/_/g, " ")}
                    </p>
                  </div>
                </div>

                <form
                  className="mt-5 space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    bookMutation.mutate();
                  }}
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-name">Your name</Label>
                    <Input
                      id="bk-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Jane Cooper"
                      autoComplete="name"
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="bk-email">Email</Label>
                    <Input
                      id="bk-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="jane@company.example.com"
                      autoComplete="email"
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      We'll send the meeting link and calendar invite here.
                    </p>
                  </div>

                  {bookMutation.isError ? (
                    <div className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                      {(bookMutation.error as Error).message}
                    </div>
                  ) : null}

                  <Button
                    type="submit"
                    size="lg"
                    className="w-full bg-brand text-brand-foreground hover:bg-brand/90"
                    loading={bookMutation.isPending}
                    disabled={!name.trim() || !email.trim()}
                  >
                    Confirm booking
                  </Button>
                </form>
              </div>
            ) : (
              /* ---- Time picker ---- */
              <div className="mt-6 flex flex-1 flex-col">
                {info.days.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center rounded-xl border border-dashed py-12 text-center">
                    <CalendarDays className="size-8 text-muted-foreground" />
                    <p className="mt-3 max-w-xs text-sm text-muted-foreground">
                      No times are available in the next two weeks. Please check
                      back later.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-baseline justify-between">
                      <p className="font-display text-base font-semibold tracking-tight">
                        {selectedDate ? dayHeading(selectedDate) : "Select a day"}
                      </p>
                      {dayData ? (
                        <span className="text-xs text-muted-foreground">
                          {dayData.slots.length} slot
                          {dayData.slots.length === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>

                    <div className="mt-4 max-h-[24rem] space-y-2.5 overflow-y-auto p-0.5 pr-1.5 lg:max-h-[26rem]">
                      {(dayData?.slots ?? []).length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                          No open times on this day. Pick another date.
                        </p>
                      ) : (
                        (dayData?.slots ?? []).map((iso) => (
                          <button
                            key={iso}
                            type="button"
                            onClick={() => setSelectedSlot(iso)}
                            className="w-full rounded-xl border border-border py-3 text-center text-sm font-semibold tabular-nums text-foreground transition-all hover:border-brand hover:bg-brand/[0.06] hover:text-brand"
                          >
                            {slotTime(iso, info.timezone)}
                          </button>
                        ))
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
