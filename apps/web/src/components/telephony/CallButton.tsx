import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mic, MicOff, Phone, PhoneCall, PhoneOff, Radio, Volume2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { placeCall } from "@/lib/api/telephony";
import { plivoWebphone, type WebphoneCallState } from "@/lib/telephony/plivo-webrtc";
import { cn } from "@/lib/utils";

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

  // Active call state for in-browser calling experience
  const [activeCall, setActiveCall] = React.useState<{
    id: string;
    fromNumber: string;
    toNumber: string;
    recipient: string;
    simulated: boolean;
  } | null>(null);

  const [callDuration, setCallDuration] = React.useState(0);
  const [isMuted, setIsMuted] = React.useState(false);
  const [webphoneStatus, setWebphoneStatus] = React.useState<WebphoneCallState>("UNINITIALIZED");

  // Subscribe to Plivo WebRTC events
  React.useEffect(() => {
    // Auto-init WebRTC client in the background on mount
    void plivoWebphone.init();

    const unsubscribe = plivoWebphone.subscribe((state, call) => {
      setWebphoneStatus(state);
      if (call) {
        setIsMuted(call.isMuted);
      }
      if (state === "ENDED" || state === "FAILED") {
        if (activeCall) {
          handleEndCall();
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, []);

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
      // 1. Pre-flight check: microphone permission
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

      // 2. Initiate CRM call record
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

      setActiveCall({
        id: res.id,
        fromNumber: fromNum,
        toNumber: toNum,
        recipient: name,
        simulated: !!res.simulated,
      });

      // 3. Trigger Plivo In-Browser WebRTC call with tracked callId
      if (toNum) {
        void plivoWebphone.makeCall(toNum, res.id).then((result) => {
          if (!result.ok) {
            toast.error(result.error || "Webphone failed to connect.");
            setActiveCall(null);
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
    if (!activeCall) return;
    plivoWebphone.hangup();
    const duration = formatTimer(callDuration);
    toast.info(`Call ended (${duration}). Audio & call details saved to timeline.`);
    setActiveCall(null);
    setIsMuted(false);

    // Refresh CRM activities & call logs
    queryClient.invalidateQueries({ queryKey: ["leads"] });
    queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
    queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
    queryClient.invalidateQueries({ queryKey: ["telephony-calls"] });
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
