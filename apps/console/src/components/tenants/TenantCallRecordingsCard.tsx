import { useQuery } from "@tanstack/react-query";
import {
  Download,
  Headphones,
  PhoneIncoming,
  PhoneOff,
  PhoneOutgoing,
  RefreshCw,
  Search,
  User,
} from "lucide-react";
import * as React from "react";

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
import { cn } from "@/lib/utils";
import {
  getTenantCalls,
  getTenantCallRecording,
  type TenantCall,
} from "@/lib/api/tenants";

interface TenantCallRecordingsCardProps {
  tenantId: string;
  tenantName: string;
}

function SuperAdminRecordingPlayer({
  tenantId,
  callId,
}: {
  tenantId: string;
  callId: string;
}) {
  const urlQuery = useQuery({
    queryKey: ["operator-call-recording", tenantId, callId],
    queryFn: () => getTenantCallRecording(tenantId, callId),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (urlQuery.isLoading) {
    return (
      <span className="text-[11px] text-muted-foreground animate-pulse py-1">
        Loading audio…
      </span>
    );
  }

  if (urlQuery.data?.pending) {
    return (
      <span className="text-[11px] text-amber-600 py-1">
        Processing…
      </span>
    );
  }

  if (!urlQuery.data?.url) {
    return <span className="text-[11px] text-muted-foreground py-1">Audio unavailable</span>;
  }

  return (
    <div className="flex items-center gap-1.5 py-0.5">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        controls
        preload="none"
        src={urlQuery.data.url}
        className="h-8 w-48 sm:w-56 md:w-60 accent-brand rounded"
      />
      <a
        href={urlQuery.data.url}
        download={`recording-${callId}.mp3`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border rounded px-2.5 py-1 transition-colors h-7 shrink-0 shadow-sm"
        title="Download MP3"
      >
        <Download className="size-3 text-slate-600" />
        MP3
      </a>
    </div>
  );
}

export function TenantCallRecordingsCard({
  tenantId,
  tenantName,
}: TenantCallRecordingsCardProps) {
  const [filter, setFilter] = React.useState<"ALL" | "RECORDINGS" | "COMPLETED" | "MISSED">("ALL");
  const [search, setSearch] = React.useState("");

  const callsQuery = useQuery({
    queryKey: ["operator-tenant-calls", tenantId],
    queryFn: () => getTenantCalls(tenantId),
    refetchInterval: 15_000,
  });

  const allCalls = React.useMemo(() => callsQuery.data ?? [], [callsQuery.data]);

  const filteredCalls = React.useMemo(() => {
    return allCalls.filter((c) => {
      if (filter === "RECORDINGS" && !c.recording_url) return false;
      if (filter === "COMPLETED" && c.call_status !== "completed") return false;
      if (filter === "MISSED" && c.outcome !== "MISSED" && c.call_status !== "no-answer") return false;

      if (search.trim()) {
        const query = search.toLowerCase();
        const num = (c.to_number || c.from_number || "").toLowerCase();
        if (!num.includes(query)) return false;
      }
      return true;
    });
  }, [allCalls, filter, search]);

  const recordingsCount = allCalls.filter((c) => !!c.recording_url).length;

  const formatDuration = (seconds?: number | null) => {
    if (!seconds || seconds <= 0) return "-";
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  };

  const getStatusBadge = (call: TenantCall) => {
    const status = (call.call_status || "queued").toLowerCase();
    if (call.outcome === "MISSED" || status === "no-answer" || status === "failed") {
      return <Badge variant="destructive">Missed / Failed</Badge>;
    }
    if (status === "completed") {
      return <Badge variant="secondary" className="bg-emerald-100 text-emerald-800">Completed</Badge>;
    }
    if (status === "in-progress" || status === "ringing") {
      return <Badge variant="outline" className="text-blue-600 border-blue-300 animate-pulse">Live Call</Badge>;
    }
    return <Badge variant="outline">{status}</Badge>;
  };

  return (
    <Card className="shadow-xs border-border/80">
      <CardHeader className="flex flex-row items-start justify-between pb-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <Headphones className="size-4 text-brand" />
              Calls & Audio Recordings Audit
            </CardTitle>
            <Badge variant="outline" className="text-[11px] font-mono">
              {allCalls.length} calls
            </Badge>
            {recordingsCount > 0 ? (
              <Badge variant="secondary" className="bg-violet-100 text-violet-800 text-[11px] font-medium">
                🎧 {recordingsCount} recordings
              </Badge>
            ) : null}
          </div>
          <CardDescription className="text-xs">
            Review live call activity, duration, caller IDs, and listen to call recordings for {tenantName}. Recordings are immutable compliance logs.
          </CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs text-muted-foreground gap-1.5"
          onClick={() => void callsQuery.refetch()}
          disabled={callsQuery.isFetching}
        >
          <RefreshCw className={cn("size-3.5", callsQuery.isFetching && "animate-spin")} />
          Refresh
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Filter controls */}
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex items-center gap-1.5 bg-muted/50 p-0.5 rounded-lg border text-xs">
            <button
              type="button"
              onClick={() => setFilter("ALL")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === "ALL" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              All ({allCalls.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter("RECORDINGS")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors flex items-center gap-1 ${
                filter === "RECORDINGS" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Headphones className="size-3" />
              With Audio ({recordingsCount})
            </button>
            <button
              type="button"
              onClick={() => setFilter("COMPLETED")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === "COMPLETED" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Completed
            </button>
            <button
              type="button"
              onClick={() => setFilter("MISSED")}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                filter === "MISSED" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Missed / Failed
            </button>
          </div>

          <div className="relative w-64 max-w-full">
            <Search className="size-3.5 text-muted-foreground absolute left-2.5 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by phone number..."
              className="h-8 text-xs pl-8 bg-background"
            />
          </div>
        </div>

        {/* Call Logs Table */}
        {callsQuery.isLoading ? (
          <div className="py-12 text-center text-xs text-muted-foreground">
            Loading call logs...
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="py-10 text-center border rounded-lg border-dashed bg-muted/20">
            <PhoneOff className="size-6 text-muted-foreground mx-auto mb-2 opacity-60" />
            <p className="text-xs font-semibold text-foreground">No call logs found</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {allCalls.length === 0
                ? "This tenant has not placed or received any calls yet."
                : "No calls match the selected filter."}
            </p>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden divide-y text-xs">
            {filteredCalls.map((call) => {
              const isInbound = call.direction === "INBOUND";
              const targetNumber = isInbound ? call.from_number : call.to_number;
              const callerId = isInbound ? call.to_number : call.from_number;

              return (
                <div
                  key={call.id}
                  className="p-3 flex flex-wrap items-center justify-between gap-3 hover:bg-muted/30 transition-colors"
                >
                  <div className="flex items-start gap-3 min-w-[220px]">
                    <div className="grid size-8 shrink-0 place-items-center rounded-full bg-muted mt-0.5">
                      {isInbound ? (
                        <PhoneIncoming className="size-4 text-sky-600" />
                      ) : (
                        <PhoneOutgoing className="size-4 text-brand" />
                      )}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-slate-900">
                          {targetNumber || "Unknown Phone"}
                        </span>
                        <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                          {isInbound ? "Inbound" : "Outbound"}
                        </Badge>
                        {call.lead_name ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Lead: {call.lead_name}
                          </Badge>
                        ) : call.contact_name ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Contact: {call.contact_name}
                          </Badge>
                        ) : null}
                        {call.simulated ? (
                          <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                            Simulated
                          </Badge>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                        <span>
                          {isInbound ? "Received on" : "From DID"}:{" "}
                          <span className="font-mono text-foreground font-semibold">
                            {callerId || "Tenant Line"}
                          </span>
                        </span>
                        {call.agent_name || call.agent_email ? (
                          <>
                            <span>•</span>
                            <span className="inline-flex items-center gap-1 text-slate-700">
                              <User className="size-3 text-muted-foreground" />
                              {call.agent_name || call.agent_email}
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {/* Duration and Timestamp */}
                  <div className="text-right text-[11px] space-y-0.5">
                    <div className="flex items-center justify-end gap-2">
                      {getStatusBadge(call)}
                      <span className="font-semibold text-slate-800 font-mono">
                        {formatDuration(call.duration_sec)}
                      </span>
                    </div>
                    <p className="text-muted-foreground">
                      {new Date(call.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>

                  {/* Audio Recording Player */}
                  <div className="w-full sm:w-auto flex items-center justify-end">
                    {call.recording_url ? (
                      <SuperAdminRecordingPlayer
                        tenantId={tenantId}
                        callId={call.id}
                      />
                    ) : (
                      <span className="text-[11px] text-muted-foreground italic">
                        No audio recording
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
