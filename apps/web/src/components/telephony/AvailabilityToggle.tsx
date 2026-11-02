import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";

import { Switch } from "@/components/ui/switch";
import { setCallAvailability } from "@/lib/api/telephony";
import { useAuthStore } from "@/stores/auth-store";

// The agent's inbound-call presence, living in the avatar dropdown next to the
// calling-number item: flip it off before a meeting and the routing algorithm
// stops ringing your phone.
export function AvailabilityToggle() {
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);
  const available = user?.available_for_calls !== false;

  const mutation = useMutation({
    mutationFn: (next: boolean) => setCallAvailability(next),
    onSuccess: (data) => {
      patchUser({ available_for_calls: data.available_for_calls });
      toast.success(
        data.available_for_calls
          ? "You are available for inbound calls."
          : "Inbound calls will skip you until you switch back on."
      );
    },
    onError: (e: Error) => toast.error(e.message || "Could not update availability."),
  });

  return (
    <div className="flex items-center justify-between gap-2.5 rounded-md px-2.5 py-2 text-sm">
      <span className="flex items-center gap-2.5">
        <span
          className={available ? "size-2 rounded-full bg-success" : "size-2 rounded-full bg-muted-foreground/50"}
          aria-hidden
        />
        Available for calls
      </span>
      <Switch
        checked={available}
        disabled={mutation.isPending}
        onCheckedChange={(next) => mutation.mutate(next)}
        aria-label="Available for inbound calls"
      />
    </div>
  );
}
