import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Radio, Volume2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiBaseUrl } from "@/lib/api/client";
import { placeCall, updateCallState } from "@/lib/api/telephony";
import { plivoWebphone, type WebphoneCallState } from "@/lib/telephony/plivo-webrtc";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

interface CallButtonProps {
  leadId?: string;
  contactId?: string;
  recipientName?: string;
  recipientPhone?: string;
  disabled?: boolean;
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
}

export function CallButton({
  leadId,
  contactId,
  recipientName,
  recipientPhone,
  disabled,
  size = "sm",
  className,
}: CallButtonProps) {
  const queryClient = useQueryClient();

  // Active call state + refs so subscription/unload handlers never read stale null closures
  const [activeCall, setActiveCall] = React.useState<{
    id: string;
    fromNumber: string;
    toNumber: string;
    recipient: string;
    simulated: boolean;
  } | null>(null);
  const activeCallRef = React.useRef(activeCall);
  activeCallRef.current = activeCall;

  const connectedRef = React.useRef(false);
  const startedAtRef = React.useRef<number | null>(null);
  const finalizedCallIdRef = React.useRef<string | null>(null);

  const [callDuration, setCallDuration] = React.useState(0);
  const [isMuted, setIsMuted] = React.useState(false);
  const [webphoneStatus, setWebphoneStatus] = React.useState<WebphoneCallState>("UNINITIALIZED");

  const invalidateCallQueries = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
    queryClient.invalidateQueries({ queryKey: ["telephony-calls"] });
  }, [queryClient, leadId, contactId]);

  const finalizeCallRef = React.useRef<
    (reason: "ended" | "failed" | "user_hangup") => void
  >(() => {});

  const finalizeCall = React.useCallback(
    (reason: "ended" | "failed" | "user_hangup") => {
      const current = activeCallRef.current;
      if (!current) return;
      if (finalizedCallIdRef.current === current.id) return;
      finalizedCallIdRef.current = current.id;

      plivoWebphone.hangup();

      const elapsed = startedAtRef.current
        ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        : 0;
      const shouldComplete = current.simulated || connectedRef.current;
      const nextStatus = shouldComplete
        ? "completed"
        : reason === "failed"
          ? "failed"
          : "canceled";

      void updateCallState(current.id, {
        status: nextStatus,
        ...(shouldComplete ? { durationSec: elapsed } : {}),
        ...(nextStatus === "failed"
          ? { callError: "WebRTC call failed before connecting" }
          : {}),
      })
        .catch(() => undefined)
        .finally(() => {
          invalidateCallQueries();
        });

      const labelDuration = `${String(Math.floor(elapsed / 60)).padStart(2, "0")}:${String(elapsed % 60).padStart(2, "0")}`;
      if (shouldComplete) {
        toast.info(`Call ended (${labelDuration}). Call details saved to timeline.`);
      } else if (nextStatus === "failed") {
        toast.error("Call failed before connecting.");
      } else {
        toast.info("Call canceled.");
      }

      activeCallRef.current = null;
      connectedRef.current = false;
      startedAtRef.current = null;
      setActiveCall(null);
      setIsMuted(false);
    },
    [invalidateCallQueries]
  );
  finalizeCallRef.current = finalizeCall;

  // Subscribe to Plivo WebRTC events
  React.useEffect(() => {
    void plivoWebphone.init();

    const unsubscribe = plivoWebphone.subscribe((state, call) => {
      setWebphoneStatus(state);
      if (call) {
        setIsMuted(call.isMuted);
      }
      const current = activeCallRef.current;
      if (!current) return;

      if (state === "ACTIVE" && !connectedRef.current) {
        connectedRef.current = true;
        startedAtRef.current = Date.now();
        void updateCallState(current.id, { status: "in-progress" })
          .then(() => invalidateCallQueries())
          .catch(() => undefined);
      } else if (state === "FAILED") {
        finalizeCallRef.current("failed");
      } else if (state === "ENDED") {
        finalizeCallRef.current("ended");
      }
    });

    const onBeforeUnload = () => {
      const current = activeCallRef.current;
      const token = useAuthStore.getState().token;
      if (!current || !token || finalizedCallIdRef.current === current.id) return;
      finalizedCallIdRef.current = current.id;
      const shouldComplete = current.simulated || connectedRef.current;
      const elapsed = startedAtRef.current
        ? Math.max(1, Math.round((Date.now() - startedAtRef.current) / 1000))
        : 0;
      void fetch(`${apiBaseUrl}/telephony/calls/${current.id}/state`, {
        method: "PATCH",
        keepalive: true,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          status: shouldComplete ? "completed" : "canceled",
          ...(shouldComplete ? { durationSec: elapsed } : {}),
        }),
      }).catch(() => undefined);
    };
    window.addEventListener("beforeunload", onBeforeUnload);

    return () => {
      unsubscribe();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [invalidateCallQueries]);

  // Call duration counter
  React.useEffect(() => {
    if (!activeCall) {
      setCallDuration(0);
      return;
    }
    const timer = window.setInterval(() => {
      setCallDuration((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeCall]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  };

  const callMutation = useMutation({
    mutationFn: async () => {
      const micCheck = await plivoWebphone.checkMicrophone();
      if (!micCheck.ok) {
        throw new Error(micCheck.error || "Microphone access blocked.");
      }

      const session = plivoWebphone.getSession();
      if (session && session.webhookLive === false && !session.simulated) {
        toast.warning(
          "Notice: Telephony webhook URL appears unreachable. Configure a public APP_PUBLIC_URL or webhook tunnel for live calls.",
          { duration: 7000 }
        );
      }

      const res = await placeCall({
        leadId,
        contactId,
        toPhone: recipientPhone,
        phone: recipientPhone,
        mode: "WEBRTC",
      });
      return res;
    },
    onSuccess: (res) => {
      const session = plivoWebphone.getSession();
      const fromNum = res.from_number || session?.callerId || "Workspace Number";
      const toNum = res.to_number || recipientPhone || "";
      const name = recipientName || "Lead / Contact";

      connectedRef.current = !!res.simulated;
      startedAtRef.current = res.simulated ? Date.now() : null;
      finalizedCallIdRef.current = null;

      const nextActive = {
        id: res.id,
        fromNumber: fromNum,
        toNumber: toNum,
        recipient: name,
        simulated: !!res.simulated,
      };
      activeCallRef.current = nextActive;
      setActiveCall(nextActive);

      if (res.simulated) {
        void updateCallState(res.id, { status: "in-progress" })
          .then(() => invalidateCallQueries())
          .catch(() => undefined);
      }

      if (toNum) {
        void plivoWebphone.makeCall(toNum, res.id).then((result) => {
          if (!result.ok) {
            finalizedCallIdRef.current = res.id;
            activeCallRef.current = null;
            connectedRef.current = false;
            startedAtRef.current = null;
            setActiveCall(null);
            toast.error(result.error || "Webphone failed to connect.");
            void updateCallState(res.id, {
              status: "failed",
              callError: result.error || "Webphone failed to connect",
            })
              .catch(() => undefined)
              .finally(() => invalidateCallQueries());
          } else {
            if (res.simulated) {
              toast.success(`In-browser call connected to ${name} via ${fromNum} (Simulation).`);
            } else {
              toast.success(`Calling ${name} via ${fromNum}...`);
            }
          }
        });
      }
    },
    onError: (e: Error) => toast.error(e.message || "Could not place the call."),
  });

  const handleEndCall = () => {
    finalizeCall("user_hangup");
  };

  return (
    <>
      <Button
        variant="outline"
        size={size}
        disabled={disabled || !!activeCall}
        loading={callMutation.isPending}
        onClick={() => callMutation.mutate()}
        className={cn("gap-1.5", className)}
      >
        <Phone className="size-4" /> Call
      </Button>

      {/* Modern Floating In-Browser Active Call Widget */}
      {activeCall ? (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-4 rounded-xl border border-brand/30 bg-card/95 p-3.5 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-bottom-4 sm:min-w-[340px]">
          <div className="relative flex size-10 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
            <PhoneCall className="size-5 animate-pulse" />
            <span className="absolute -top-0.5 -right-0.5 flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-emerald-500" />
            </span>
          </div>

          <div className="flex-1 min-w-0 space-y-0.5">
            <div className="flex items-center gap-2">
              <p className="truncate text-sm font-semibold text-foreground">
                {activeCall.recipient}
              </p>
              {activeCall.simulated ? (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-amber-500/40 text-amber-600">
                  Simulated
                </Badge>
              ) : (
                <Badge variant="outline" className="text-[10px] px-1 py-0 border-emerald-500/40 text-emerald-600 gap-1">
                  <Volume2 className="size-2.5" /> WebRTC Live
                </Badge>
              )}
            </div>
            <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
              <Radio className="size-3 text-emerald-500" />
              <span>Caller ID: {activeCall.fromNumber}</span>
            </p>
            <div className="flex items-center gap-2">
              <p className="font-mono text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {formatTimer(callDuration)}
              </p>
              {webphoneStatus === "CONNECTING" ? (
                <span className="text-[10px] text-muted-foreground animate-pulse">
                  Connecting mic...
                </span>
              ) : webphoneStatus === "RINGING" ? (
                <span className="text-[10px] text-amber-500 animate-pulse font-medium">
                  Ringing 🔔...
                </span>
              ) : webphoneStatus === "ACTIVE" ? (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  Connected
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                const muted = plivoWebphone.toggleMute();
                setIsMuted(muted);
                toast.info(muted ? "Microphone muted" : "Microphone unmuted");
              }}
              className="size-8 p-0 text-muted-foreground hover:bg-muted"
              title={isMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {isMuted ? (
                <MicOff className="size-4 text-destructive" />
              ) : (
                <Mic className="size-4" />
              )}
            </Button>

            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleEndCall}
              className="h-8 gap-1.5 px-3 text-xs font-medium shadow-sm hover:bg-destructive/90"
            >
              <PhoneOff className="size-3.5" /> End Call
            </Button>
          </div>
        </div>
      ) : null}
    </>
  );
}
