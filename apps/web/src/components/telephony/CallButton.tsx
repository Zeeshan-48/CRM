import { useMutation } from "@tanstack/react-query";
import { Phone } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { placeCall } from "@/lib/api/telephony";
import { useAuthStore } from "@/stores/auth-store";

// Click-to-call: rings the agent's saved phone, then bridges to the lead/contact.
// The caller's own number comes from their profile (users.phone), no prompt.
export function CallButton({
  leadId,
  contactId,
  disabled,
}: {
  leadId?: string;
  contactId?: string;
  disabled?: boolean;
}) {
  const savedPhone = useAuthStore((s) => s.user?.phone);

  const callMutation = useMutation({
    mutationFn: () => placeCall({ leadId, contactId }),
    onSuccess: (res) => {
      if (res.simulated) {
        toast.success("Call simulated (connect a Twilio account to place real calls).");
      } else {
        toast.success("Calling. Your phone will ring, then we connect the lead.");
      }
    },
    onError: (e: Error) => toast.error(e.message || "Could not place the call."),
  });

  const handleCall = () => {
    if (!savedPhone) {
      toast.error(
        "Add your phone number in your profile first, that's the number we'll ring when you call a lead.",
      );
      return;
    }
    callMutation.mutate();
  };

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={disabled}
      loading={callMutation.isPending}
      onClick={handleCall}
    >
      <Phone className="size-4" /> Call
    </Button>
  );
}
