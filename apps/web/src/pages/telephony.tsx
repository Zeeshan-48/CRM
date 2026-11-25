import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Headphones,
  Mic,
  Phone,
  PhoneCall,
  PhoneIncoming,
  PhoneMissed,
  PhoneOff,
  PhoneOutgoing,
  RefreshCw,
  Search,
  ShieldCheck,
  User,
  Volume2,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { PageHeader } from "@/components/layout/PageHeader";
import { RecordingPlayer } from "@/components/telephony/RecordingPlayer";
import { CallButton } from "@/components/telephony/CallButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { getWebRTCSession, listCalls, listNumbers } from "@/lib/api/telephony";
import { plivoWebphone } from "@/lib/telephony/plivo-webrtc";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

type Tone = "success" | "danger" | "warning" | "info" | "neutral";

interface CallState {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  live?: boolean;
}

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

const TONE_CLASS: Record<Tone, string> = {
  success: "text-emerald-600 bg-emerald-50 border-emerald-200",
  danger: "text-rose-600 bg-rose-50 border-rose-200",
  warning: "text-amber-600 bg-amber-50 border-amber-200",
  info: "text-blue-600 bg-blue-50 border-blue-200",
  neutral: "text-slate-600 bg-slate-50 border-slate-200",
};

const formatDuration = (seconds?: number | null): string => {
  if (!seconds || seconds <= 0) return "-";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
};

const formatTotalTalkTime = (totalSeconds: number): string => {
  if (!totalSeconds || totalSeconds <= 0) return "0m";
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
};

export default function TelephonyPage() {
  const [filter, setFilter] = React.useState<
    "ALL" | "RECORDINGS" | "COMPLETED" | "MISSED" | "OUTBOUND" | "INBOUND"
  >("ALL");
  const [search, setSearch] = React.useState("");
  const [dialNumber, setDialNumber] = React.useState("");
  const [micTesting, setMicTesting] = React.useState(false);

  const handleTestMic = async () => {
    setMicTesting(true);
    try {
      const res = await plivoWebphone.checkMicrophone();
      if (res.ok) {
        toast.success("Microphone is connected and working perfectly!");
      } else {
        toast.error(res.error || "Microphone check failed.");
      }
    } finally {
      setMicTesting(false);
    }
  };

  const numbersQuery = useQuery({
    queryKey: ["telephony-numbers"],
    queryFn: listNumbers,
  });

  const sessionQuery = useQuery({
    queryKey: ["webrtc-session"],
    queryFn: getWebRTCSession,
    refetchInterval: 15_000,
  });

  const callsQuery = useQuery({
    queryKey: ["telephony-calls"],
    queryFn: listCalls,
    refetchInterval: (query) =>
      query.state.data?.some((c) => describeCall(c.call_status).live) ? 4_000 : 15_000,
  });

  const calls = React.useMemo(() => callsQuery.data ?? [], [callsQuery.data]);
  const numbers = numbersQuery.data ?? [];
  const liveCalls = calls.filter((c) => describeCall(c.call_status).live).length;

  // KPI calculations
  const totalCallsCount = calls.length;
  const completedCallsCount = calls.filter((c) => c.call_status === "completed").length;
  const recordingsCount = calls.filter((c) => !!c.recording_url).length;
  const totalSeconds = calls.reduce((acc, c) => acc + (c.duration_sec || 0), 0);
  const successRate = totalCallsCount > 0 ? Math.round((completedCallsCount / totalCallsCount) * 100) : 0;

  // Filtered calls
  const filteredCalls = React.useMemo(() => {
    return calls.filter((c) => {
      if (filter === "RECORDINGS" && !c.recording_url) return false;
      if (filter === "COMPLETED" && c.call_status !== "completed") return false;
      if (filter === "MISSED" && c.outcome !== "MISSED" && c.call_status !== "no-answer") return false;
      if (filter === "OUTBOUND" && c.direction !== "OUTBOUND") return false;
      if (filter === "INBOUND" && c.direction !== "INBOUND") return false;

      if (search.trim()) {
        const query = search.toLowerCase();
        const target = (c.to_number || c.from_number || "").toLowerCase();
        if (!target.includes(query)) return false;
      }
      return true;
    });
  }, [calls, filter, search]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Telephony & Call Center"
        description="Direct in-browser web calling, centralized Caller ID numbers, and tamper-proof call audio recordings."
      />

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Total Calls</p>
              <p className="text-2xl font-bold font-mono tracking-tight text-foreground">
                {totalCallsCount}
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-lg bg-blue-50 text-blue-600">
              <PhoneCall className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Total Talk Time</p>
              <p className="text-2xl font-bold font-mono tracking-tight text-foreground">
                {formatTotalTalkTime(totalSeconds)}
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <Clock className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Answered Rate</p>
              <p className="text-2xl font-bold font-mono tracking-tight text-foreground">
                {successRate}%
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-lg bg-amber-50 text-amber-600">
              <Phone className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-xs border-border/80">
          <CardContent className="p-4 flex items-center justify-between">
            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Audio Recordings</p>
              <p className="text-2xl font-bold font-mono tracking-tight text-foreground">
                {recordingsCount}
              </p>
            </div>
            <div className="grid size-10 place-items-center rounded-lg bg-violet-50 text-violet-600">
              <Headphones className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Allocated Virtual Numbers & Web Calling Info */}
      <Card className="shadow-xs border-border/80">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <ShieldCheck className="size-4 text-emerald-600" />
                Assigned Virtual Numbers & Caller IDs
              </CardTitle>
              <CardDescription className="text-xs">
                These numbers are managed and allocated to your workspace by the platform Super Admin. All outbound web calls use these numbers as Caller ID.
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 text-xs gap-1.5 py-1">
              <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
              Direct In-Browser Calling Active
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {numbersQuery.isLoading ? (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Loading allocated virtual numbers...
            </div>
          ) : numbers.length === 0 ? (
            <div className="p-4 rounded-lg bg-amber-50/70 border border-amber-200/80 text-amber-900 text-xs flex items-center justify-between">
              <p>
                No virtual numbers are allocated yet. Please request your Super Admin to allocate an outbound virtual number for this workspace.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {numbers.map((n) => (
                <div
                  key={n.id}
                  className="p-3 rounded-lg border bg-muted/20 flex flex-col justify-between space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-sm font-bold text-foreground">
                      {n.phone}
                    </span>
                    <Badge variant={n.active ? "success" : "neutral"} className="text-[10px]">
                      {n.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{n.label || "Workspace Line"}</span>
                    <Badge variant="outline" className="text-[9px] font-semibold uppercase">
                      {n.kind === "MAIN" ? "Default Caller ID" : "Agent Line"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Live In-Browser WebRTC Softphone Dialer */}
      <Card className="shadow-xs border-brand/30 bg-gradient-to-r from-card to-brand/5">
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Volume2 className="size-4 text-brand" />
                Live In-Browser Softphone (WebRTC Calling)
              </CardTitle>
              <CardDescription className="text-xs">
                Make direct voice calls right from your web browser using your computer's microphone and headset.
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {sessionQuery.data?.webhookLive ? (
                <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-300 text-xs gap-1.5 py-1">
                  <span className="size-2 rounded-full bg-emerald-500 animate-pulse" />
                  PSTN Webhook Live ({new URL(sessionQuery.data.webhookUrl || "https://cloudflared").hostname.slice(0, 24)}...)
                </Badge>
              ) : (
                <Badge
                  variant="outline"
                  className="text-amber-700 bg-amber-50 border-amber-300 text-xs gap-1.5 py-1"
                  title="Tunnel is offline. Real calls require a live public webhook to ring mobile numbers. Run start-crm.bat."
                >
                  <span className="size-2 rounded-full bg-amber-500" />
                  Tunnel Offline (Run start-crm.bat)
                </Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                disabled={micTesting}
                onClick={handleTestMic}
              >
                <Mic className="size-3.5 text-brand" />
                {micTesting ? "Testing Mic..." : "Test Mic 🎙️"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 max-w-xl">
            <div className="relative flex-1">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Enter destination phone (e.g. +919876543210)"
                value={dialNumber}
                onChange={(e) => setDialNumber(e.target.value)}
                className="pl-9 font-mono text-sm bg-background"
              />
            </div>
            <CallButton
              recipientPhone={dialNumber.trim()}
              recipientName={dialNumber.trim() || "Web Dialer"}
              disabled={!dialNumber.trim()}
              size="default"
              className="px-5 h-9 bg-brand text-primary-foreground hover:bg-brand/90 font-medium"
            />
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            Outgoing calls display your workspace caller ID (<span className="font-mono font-medium text-foreground">{numbers[0]?.phone || "your configured DID"}</span>). Your personal number is never revealed.
          </p>
        </CardContent>
      </Card>

      {/* Call History & Audio Recordings Console */}
      <Card className="shadow-xs border-border/80">
        <CardHeader className="flex flex-row items-start justify-between pb-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <Headphones className="size-4 text-brand" />
                Call Logs & Audio Recordings
              </CardTitle>
              {liveCalls > 0 ? (
                <Badge variant="info" className="text-[10px] animate-pulse">
                  {liveCalls} live
                </Badge>
              ) : null}
            </div>
            <CardDescription className="text-xs">
              Review all incoming and outgoing conversations. Click play to listen to audio recordings or download MP3 files.
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground gap-1.5"
            onClick={() => void callsQuery.refetch()}
            loading={callsQuery.isFetching}
          >
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </CardHeader>

        <CardContent className="space-y-4">
          {/* Filter Bar */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5 bg-muted/50 p-1 rounded-lg border text-xs">
              <button
                type="button"
                onClick={() => setFilter("ALL")}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  filter === "ALL" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                All ({calls.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter("RECORDINGS")}
                className={`px-3 py-1 rounded-md font-medium transition-colors flex items-center gap-1.5 ${
                  filter === "RECORDINGS" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Headphones className="size-3 text-violet-600" />
                Recordings ({recordingsCount})
              </button>
              <button
                type="button"
                onClick={() => setFilter("COMPLETED")}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  filter === "COMPLETED" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Completed
              </button>
              <button
                type="button"
                onClick={() => setFilter("MISSED")}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  filter === "MISSED" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Missed
              </button>
              <button
                type="button"
                onClick={() => setFilter("OUTBOUND")}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  filter === "OUTBOUND" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Outbound
              </button>
              <button
                type="button"
                onClick={() => setFilter("INBOUND")}
                className={`px-3 py-1 rounded-md font-medium transition-colors ${
                  filter === "INBOUND" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                Inbound
              </button>
            </div>

            <div className="relative w-64 max-w-full">
              <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search phone number..."
                className="h-8 text-xs pl-8 bg-background"
              />
            </div>
          </div>

          {/* Calls List */}
          {callsQuery.isLoading ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              <Spinner size="md" className="mx-auto mb-2 text-brand" />
              Loading calls…
            </div>
          ) : filteredCalls.length === 0 ? (
            <div className="py-12 text-center border rounded-lg border-dashed bg-muted/20">
              <PhoneCall className="size-7 text-muted-foreground mx-auto mb-2 opacity-50" />
              <p className="text-sm font-semibold text-foreground">No calls found</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {calls.length === 0
                  ? "Calls dialed from leads or contacts will appear here automatically."
                  : "No calls match the selected filter."}
              </p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden divide-y text-xs">
              {filteredCalls.map((c) => {
                const inbound = c.direction === "INBOUND";
                const missed = c.outcome === "MISSED";
                const state = missed
                  ? { label: "Missed", tone: "danger" as Tone, icon: PhoneMissed }
                  : describeCall(c.call_status);
                const Icon = inbound && !missed ? PhoneIncoming : state.icon;
                const duration = formatDuration(c.duration_sec);
                const number = inbound ? c.from_number : c.to_number;
                const callerId = inbound ? c.to_number : c.from_number;

                return (
                  <div
                    key={c.id}
                    className="p-3.5 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:bg-muted/20 transition-colors"
                  >
                    {/* Left: Direction & Target Number & Lead link */}
                    <div className="flex items-start gap-3 min-w-[240px]">
                      <div
                        className={cn(
                          "grid size-8 shrink-0 place-items-center rounded-full border mt-0.5",
                          TONE_CLASS[state.tone]
                        )}
                      >
                        <Icon className={cn("size-4", !missed && state.live && "animate-pulse")} />
                      </div>

                      <div className="space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-bold text-foreground">
                            {number || "Unknown Number"}
                          </span>
                          <Badge variant="outline" className="text-[10px] font-semibold">
                            {inbound ? "Inbound" : "Outbound Web Call"}
                          </Badge>
                          {c.lead_name ? (
                            <Badge variant="secondary" className="text-[10px] font-medium">
                              Lead: {c.lead_name}{c.lead_company ? ` (${c.lead_company})` : ""}
                            </Badge>
                          ) : c.contact_name ? (
                            <Badge variant="secondary" className="text-[10px] font-medium">
                              Contact: {c.contact_name}{c.contact_company ? ` (${c.contact_company})` : ""}
                            </Badge>
                          ) : null}
                          {c.simulated ? (
                            <Badge variant="warning" className="text-[10px]">
                              Simulated
                            </Badge>
                          ) : null}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                          {c.lead_id ? (
                            <Link
                              to={`/leads/${c.lead_id}`}
                              className="font-medium text-brand hover:underline"
                            >
                              View Lead
                            </Link>
                          ) : null}
                          {callerId ? (
                            <>
                              {c.lead_id ? <span>•</span> : null}
                              <span>
                                {inbound ? "Received on" : "From DID"}:{" "}
                                <strong className="font-mono text-foreground">{callerId}</strong>
                              </span>
                            </>
                          ) : null}
                          {c.agent_name || c.agent_email ? (
                            <>
                              <span>•</span>
                              <span className="inline-flex items-center gap-1 text-slate-700">
                                <User className="size-3 text-muted-foreground" />
                                {c.agent_name || c.agent_email}
                              </span>
                            </>
                          ) : null}
                        </div>

                        {c.call_error ? (
                          <p className="text-[11px] text-rose-600 font-medium">{c.call_error}</p>
                        ) : null}
                      </div>
                    </div>

                    {/* Middle: Duration and Timestamp */}
                    <div className="flex items-center md:flex-col md:items-end justify-between md:justify-center text-xs space-y-0.5">
                      <div className="flex items-center gap-2">
                        <Badge variant={state.tone} className="text-[10px]">
                          {state.label}
                        </Badge>
                        <span className="font-mono font-semibold text-foreground">
                          {duration}
                        </span>
                      </div>
                      <span
                        className="text-[11px] text-muted-foreground tabular-nums"
                        title={formatDateTime(c.created_at)}
                      >
                        {timeAgo(c.created_at)}
                      </span>
                    </div>

                    {/* Right: Audio Recording Player & One-Click Call Button */}
                    <div className="flex items-center justify-end gap-2 shrink-0">
                      {c.recording_url ? (
                        <RecordingPlayer callId={c.id} />
                      ) : (
                        <span className="text-[11px] text-muted-foreground italic px-2">
                          No recording
                        </span>
                      )}

                      {c.lead_id && number ? (
                        <CallButton
                          leadId={c.lead_id}
                          recipientName="Lead"
                          recipientPhone={number}
                          size="sm"
                          className="h-7 text-xs px-2.5"
                        />
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
