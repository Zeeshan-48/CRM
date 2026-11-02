import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  addNumber,
  listNumbers,
  removeNumber,
  updateNumber,
  type TelephonyNumber,
} from "@/lib/api/telephony";
import { listUsers } from "@/lib/api/users";

// The ExoPhone pool: the main marketing number plus per-agent dedicated
// numbers. A dedicated number is both the agent's outbound caller ID and a
// direct inbound line to them, leads keep seeing (and saving) one number per
// relationship, which is what keeps outbound off spam lists.
export function NumbersSection() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();

  const numbersQuery = useQuery({ queryKey: ["telephony-numbers"], queryFn: listNumbers });
  const usersQuery = useQuery({ queryKey: ["users"], queryFn: listUsers });

  const [addOpen, setAddOpen] = React.useState(false);
  const [phone, setPhone] = React.useState("");
  const [label, setLabel] = React.useState("");
  const [kind, setKind] = React.useState<"MAIN" | "AGENT">("AGENT");
  const [assignee, setAssignee] = React.useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["telephony-numbers"] });

  const addMutation = useMutation({
    mutationFn: () =>
      addNumber({
        phone,
        label: label || undefined,
        kind,
        assignedUserId: kind === "AGENT" ? assignee : undefined,
      }),
    onSuccess: () => {
      toast.success("Number added.");
      setAddOpen(false);
      setPhone("");
      setLabel("");
      setAssignee("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not add the number."),
  });

  const toggleMutation = useMutation({
    mutationFn: (n: TelephonyNumber) => updateNumber(n.id, { active: !n.active }),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message || "Could not update the number."),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeNumber(id),
    onSuccess: () => {
      toast.success("Number removed.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message || "Could not remove the number."),
  });

  const handleRemove = async (n: TelephonyNumber) => {
    const ok = await confirm({
      title: `Remove ${n.phone}?`,
      description:
        "Inbound calls to it will no longer route through the CRM, and its agent falls back to the main number for outbound caller ID.",
      confirmText: "Remove",
      destructive: true,
    });
    if (ok) removeMutation.mutate(n.id);
  };

  const users = usersQuery.data ?? [];
  const agentName = (id: string | null) => users.find((u) => u.id === id)?.name ?? "Unassigned";
  const numbers = numbersQuery.data ?? [];
  const canSubmit = !!phone && (kind === "MAIN" || !!assignee);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Hash className="size-4 text-brand" />
            ExoPhone numbers
          </CardTitle>
          <CardDescription>
            Numbers rented from Exotel, used as your caller ID. Optional: assign a
            dedicated ExoPhone per agent so leads always see the same number, calls back
            to it ring that agent first, and outbound volume spreads across the pool.
            Agents receive calls on their own phones. Set those in Users &amp; Roles, not
            here.
          </CardDescription>
        </div>
        <Button size="sm" variant="outline" className="shrink-0" onClick={() => setAddOpen(true)}>
          <Plus className="size-4" /> Add number
        </Button>
      </CardHeader>
      <CardContent>
        {numbers.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No numbers yet. Validating your Exotel account adds the main ExoPhone
            automatically; rented agent ExoPhones get added here.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {numbers.map((n) => (
              <li key={n.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className="font-mono text-sm font-medium">{n.phone}</span>
                <Badge variant={n.kind === "MAIN" ? "brand" : "neutral"}>
                  {n.kind === "MAIN" ? "Main" : "Agent"}
                </Badge>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {n.label ? `${n.label} · ` : ""}
                  {n.kind === "AGENT" ? agentName(n.assigned_user_id) : "Routing algorithm"}
                </span>
                <Switch
                  checked={n.active}
                  onCheckedChange={() => toggleMutation.mutate(n)}
                  aria-label={`${n.phone} active`}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-8 p-0 text-muted-foreground hover:text-destructive"
                  onClick={() => void handleRemove(n)}
                  aria-label={`Remove ${n.phone}`}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add an ExoPhone</DialogTitle>
            <DialogDescription>
              Only numbers rented from Exotel go here, and the number must already exist
              on your Exotel account with your call flow assigned to it in App Bazaar.
              An agent&apos;s personal mobile is not an ExoPhone: set that on their
              profile in Users &amp; Roles instead.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="num-phone">ExoPhone</Label>
              <Input
                id="num-phone"
                value={phone}
                placeholder="+15555550100"
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="num-label">Label (optional)</Label>
              <Input
                id="num-label"
                value={label}
                placeholder="Asha's line"
                onChange={(e) => setLabel(e.target.value)}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="numberssection-kind">Kind</Label>
                <Select value={kind} onValueChange={(v) => setKind(v as "MAIN" | "AGENT")}>
                  <SelectTrigger id="numberssection-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AGENT">Agent line</SelectItem>
                    <SelectItem value="MAIN">Main (routing algorithm)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {kind === "AGENT" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="numberssection-assigned-agent">Assigned agent</Label>
                  <Select value={assignee} onValueChange={setAssignee}>
                    <SelectTrigger id="numberssection-assigned-agent">
                      <SelectValue placeholder="Pick an agent" />
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={addMutation.isPending}
              disabled={!canSubmit}
              onClick={() => addMutation.mutate()}
            >
              Add number
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
