import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateMyPhone } from "@/lib/api/users";
import { useAuthStore } from "@/stores/auth-store";

// Lets any user set their callback (mobile) number used by click-to-call.
// Persists to their profile so it follows them across devices.
export function CallingNumberDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const user = useAuthStore((s) => s.user);
  const patchUser = useAuthStore((s) => s.patchUser);
  const [phone, setPhone] = React.useState("");

  // Sync the field with the saved number whenever the dialog opens.
  React.useEffect(() => {
    if (open) setPhone(user?.phone ?? "");
  }, [open, user?.phone]);

  const saveMutation = useMutation({
    mutationFn: () => updateMyPhone(phone.trim()),
    onSuccess: (res) => {
      patchUser({ phone: res.phone });
      toast.success(res.phone ? "Calling number saved." : "Calling number cleared.");
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message || "Could not save your number."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your calling number</DialogTitle>
          <DialogDescription>
            When you click Call on a lead, we ring this phone first, then connect the lead.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="callingNumber">Mobile number</Label>
          <Input
            id="callingNumber"
            placeholder="+14155550123"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoCapitalize="none"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">
            International format, e.g. +14155550123. Leave empty to remove.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
