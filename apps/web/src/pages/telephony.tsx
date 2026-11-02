import { useQuery } from "@tanstack/react-query";
import {
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  RefreshCw,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";

import { PageHeader } from "@/components/layout/PageHeader";
import { ExotelConnectionCard } from "@/components/telephony/ExotelConnectionCard";
import { NumbersSection } from "@/components/telephony/NumbersSection";
import { RecordingPlayer } from "@/components/telephony/RecordingPlayer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Spinner, SpinnerOverlay } from "@/components/ui/spinner";
import { getTelephony, listCalls } from "@/lib/api/telephony";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "success" | "danger" | "warning" | "info" | "neutral";

interface CallState {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** A status the call can still move out of, drives the live auto-refresh. */
  live?: boolean;
}

// Providers report wire values ("no-answer", "in-progress"), which we were
// showing to users verbatim. Map each to a human label, a tone and an icon.
// Twilio and Exotel share this terminal vocabulary.
const CALL_STATES: Record<string, CallState> = {
  queued: { label: "Queued", tone: "neutral", icon: PhoneOutgoing, live: true },
  initiated: { label: "Calling", tone: "info", icon: PhoneOutgoing, live: true },
  ringing: { label: "Ringing", tone: "info", icon: PhoneOutgoing, live: true },
  "in-progress": { label: "In progress", tone: "info", icon: PhoneCall, live: true },
  completed: { label: "Completed", tone: "success", icon: PhoneCall },
  busy: { label: "Busy", tone: "warning", icon: PhoneOff },
  "no-answer": { label: "No answer", tone: "warning", icon: PhoneMissed },
  canceled: { label: "Canceled", tone: "neutral", icon: PhoneOff },
  failed: { label: "Failed", tone: "danger", icon: PhoneOff },
};

const describeCall = (status: string | null): CallState =>
  CALL_STATES[status ?? "queued"] ?? { label: status ?? "Queued", tone: "neutral", icon: PhoneCall };

// Same /12 tint the Badge variants use, so the row icon and its badge read as one.
const TONE_CLASS: Record<Tone, string> = {
  success: "text-success",
  danger: "text-danger",
  warning: "text-warning",
  info: "text-info",
  neutral: "text-neutral",
};

// A call that never connected has no talk time, and a bare "0s" reads as a bug.
// Return null so the row simply omits it.
const formatDuration = (seconds: number): string | null => {
  if (!seconds || seconds <= 0) return null;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};



export default function TelephonyPage() {
  const configQuery = useQuery({ queryKey: ["telephony"], queryFn: getTelephony });
  const callsQuery = useQuery({
    queryKey: ["telephony-calls"],
    queryFn: listCalls,
    // Re-poll only while a call is still live, then stop, an idle page
    // shouldn't hammer the API forever.
    refetchInterval: (query) =>
      query.state.data?.some((c) => describeCall(c.call_status).live) ? 5_000 : false,
  });
  const cfg = configQuery.data;
  const calls = callsQuery.data ?? [];
  const liveCalls = calls.filter((c) => describeCall(c.call_status).live).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Telephony"
        description="Connect a telephony provider so agents call leads with one click, inbound calls route to the right agent, and every conversation lands on the lead's timeline."
      />

      {configQuery.isLoading ? (
        <Card>
          <CardContent>
            <SpinnerOverlay label="Loading telephony settings" className="py-16" />
          </CardContent>
        </Card>
      ) : (
        <>

          <section className="reveal" style={{ animationDelay: "40ms" }}>
            <ExotelConnectionCard cfg={cfg} />
          </section>

          {/* ExoPhone pool */}
          <section className="reveal" style={{ animationDelay: "100ms" }}>
            <NumbersSection />
          </section>

          {/* Recent calls */}
          <section className="reveal" style={{ animationDelay: "160ms" }}>
            <Card>
              <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <PhoneCall className="size-4 text-brand" />
                    Recent calls
                    {calls.length > 0 ? <Badge variant="neutral">{calls.length}</Badge> : null}
                  </CardTitle>
                  <CardDescription>
                    {liveCalls > 0
                      ? `${liveCalls} call${liveCalls > 1 ? "s" : ""} in progress, updating live.`
                      : "Status updates a few seconds after each call ends."}
                  </CardDescription>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-muted-foreground"
                  loading={callsQuery.isFetching}
                  onClick={() => void callsQuery.refetch()}
                  aria-label="Refresh calls"
                >
                  <RefreshCw className="size-4" />
                </Button>
              </CardHeader>
              <CardContent>
                {callsQuery.isLoading ? (
                  <div className="flex justify-center py-8">
                    <Spinner size="md" className="text-brand" label="Loading calls" />
                  </div>
                ) : calls.length === 0 ? (
                  <div className="flex flex-col items-center gap-1 py-10 text-center">
                    <PhoneCall className="size-6 text-muted-foreground" />
                    <p className="text-sm font-medium">No calls yet</p>
                    <p className="text-xs text-muted-foreground">
                      Calls you place from a lead or contact, and inbound calls to your
                      numbers, will show up here.
                    </p>
                  </div>
                ) : (
                  // Height-capped and scrollable: the list is unbounded otherwise
                  // and pushes the rest of the page off-screen once calls pile up.
                  <ul className="max-h-[26rem] divide-y overflow-y-auto rounded-md border">
                    {calls.map((c) => {
                      const inbound = c.direction === "INBOUND";
                      const missed = c.outcome === "MISSED";
                      const state = missed
                        ? { label: "Missed", tone: "danger" as Tone, icon: PhoneMissed }
                        : describeCall(c.call_status);
                      const Icon = inbound && !missed ? PhoneIncoming : state.icon;
                      const duration = formatDuration(c.duration_sec);
                      const number = inbound ? c.from_number : c.to_number;
                      return (
                        <li key={c.id} className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "grid size-8 shrink-0 place-items-center rounded-full",
                                TONE_CLASS[state.tone]
                              )}
                            >
                              <Icon
                                className={cn("size-4", !missed && state.live && "animate-pulse")}
                              />
                            </span>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate font-mono text-sm font-medium">
                                  {/* || not ??: manual logs store "" for the number,
                                      which is not nullish and rendered as a blank. */}
                                  {number || (c.provider === "manual" ? "Logged call" : "Unknown number")}
                                </span>
                                {inbound ? <Badge variant="info">Inbound</Badge> : null}
                                {c.provider === "manual" ? (
                                  <Badge variant="neutral">Logged</Badge>
                                ) : null}
                                {c.simulated ? <Badge variant="warning">Simulated</Badge> : null}
                              </div>
                              {/* The failure reason matters more than the lead link, so
                                  it wins the one line of secondary text we allow. */}
                              {c.call_error ? (
                                <p className="truncate text-xs text-danger" title={c.call_error}>
                                  {c.call_error}
                                </p>
                              ) : c.lead_id ? (
                                <Link
                                  to={`/leads/${c.lead_id}`}
                                  className="text-xs text-muted-foreground underline-offset-2 hover:text-brand hover:underline"
                                >
                                  View lead
                                </Link>
                              ) : null}
                            </div>

                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <Badge variant={state.tone}>{state.label}</Badge>
                              <span
                                className="whitespace-nowrap text-xs tabular-nums text-muted-foreground"
                                title={formatDateTime(c.created_at)}
                              >
                                {duration ? `${duration} · ` : ""}
                                {timeAgo(c.created_at)}
                              </span>
                            </div>
                          </div>
                          {c.recording_url ? (
                            <div className="mt-1.5 pl-11">
                              <RecordingPlayer callId={c.id} />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
