import { useMutation, useQuery } from "@tanstack/react-query";
import { Search, Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { listLeads } from "@/lib/api/leads";
import { listWaTemplates, sendWhatsApp } from "@/lib/api/whatsapp";

// A one-off WhatsApp composer: pick a lead, send free text (only delivers inside
// the recipient's 24h window) or an approved template (for cold sends).
export function WhatsAppSendCard() {
  const [q, setQ] = React.useState("");
  const [leadId, setLeadId] = React.useState("");
  const [mode, setMode] = React.useState<"text" | "template">("text");
  const [body, setBody] = React.useState("");
  const [templateKey, setTemplateKey] = React.useState("");

  const leadsQuery = useQuery({
    queryKey: ["wa-send-leads", q],
    queryFn: () => listLeads({ q: q.trim() || undefined, limit: 20 }),
  });
  const leads = leadsQuery.data?.leads ?? [];

  const templatesQuery = useQuery({ queryKey: ["wa-templates"], queryFn: listWaTemplates });
  const templates = templatesQuery.data ?? [];

  const selectedLead = leads.find((l) => l.id === leadId);

  const sendMutation = useMutation({
    mutationFn: () =>
      sendWhatsApp({
        leadId,
        ...(mode === "template" ? { templateKey } : { body: body.trim() }),
      }),
    onSuccess: (result) => {
      if (result.delivered) {
        // Meta accepted it synchronously, that is NOT a delivery confirmation.
        // Final delivered/read/failed status only arrives via webhooks (Phase 2).
        toast.success("Accepted by WhatsApp.", {
          description:
            "Meta queued the message. If it doesn't arrive, the recipient is likely outside the 24h window (free text needs them to message you first) or not opted in.",
        });
      } else if (result.error) {
        toast.error("WhatsApp rejected the message.", { description: result.error });
      } else {
        toast.success("Message recorded (simulated).", {
          description: "No live WhatsApp account, or simulation mode is on.",
        });
      }
      setBody("");
    },
    onError: (e: Error) => toast.error(e.message || "Could not send the message."),
  });

  const canSend =
    !!leadId && (mode === "template" ? !!templateKey : body.trim().length > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>Send a message</CardTitle>
        <CardDescription>
          Pick a lead and send a one-off WhatsApp. Free text only delivers within 24h of the
          contact's last message; cold sends need an approved template.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Recipient */}
        <div className="space-y-1.5">
          <Label htmlFor="whatsappsendcard-recipient">Recipient</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input id="whatsappsendcard-recipient"
              placeholder="Search leads by name…"
              className="pl-8"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoCapitalize="none"
            />
          </div>
          <Select value={leadId} onValueChange={setLeadId}>
            <SelectTrigger>
              <SelectValue
                placeholder={leadsQuery.isLoading ? "Loading leads…" : "Select a lead"}
              />
            </SelectTrigger>
            <SelectContent>
              {leads.length === 0 ? (
                <div className="px-2 py-1.5 text-sm text-muted-foreground">No leads found.</div>
              ) : (
                leads.map((lead) => (
                  <SelectItem key={lead.id} value={lead.id}>
                    {lead.name}
                    {lead.phone ? ` · ${lead.phone}` : " · (no phone)"}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          {selectedLead && !selectedLead.phone ? (
            <p className="text-xs text-amber-700">
              This lead has no phone number, add one before sending.
            </p>
          ) : null}
        </div>

        {/* Mode toggle */}
        <div className="flex gap-1.5">
          {(["text", "template"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={
                "rounded-md border px-3 py-1 text-xs font-medium transition-colors " +
                (mode === m
                  ? "border-transparent bg-brand text-brand-foreground"
                  : "text-muted-foreground hover:border-brand hover:text-brand")
              }
            >
              {m === "text" ? "Free text" : "Template"}
            </button>
          ))}
        </div>

        {mode === "text" ? (
          <div className="space-y-1.5">
            <Label htmlFor="wa-send-body">Message</Label>
            <Textarea
              id="wa-send-body"
              rows={4}
              placeholder="Type your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="wa-send-template">Template</Label>
            <Select value={templateKey} onValueChange={setTemplateKey}>
              <SelectTrigger id="wa-send-template">
                <SelectValue
                  placeholder={templates.length === 0 ? "No templates yet" : "Pick a template"}
                />
              </SelectTrigger>
              <SelectContent>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.key}>
                    {t.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              The key must match an approved template name in your Meta account.
            </p>
          </div>
        )}

        <Button loading={sendMutation.isPending} disabled={!canSend} onClick={() => sendMutation.mutate()}>
          {sendMutation.isPending ? null : <Send className="size-4" />} Send WhatsApp
        </Button>

        {leadsQuery.isFetching && q ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner size="xs" /> Searching…
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
