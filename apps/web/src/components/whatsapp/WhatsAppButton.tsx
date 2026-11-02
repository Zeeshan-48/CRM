import { useMutation, useQuery } from "@tanstack/react-query";
import { MessageCircle, Send } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  listWaTemplates,
  sendWhatsApp,
  type SendWhatsAppInput,
  type SendWhatsAppResult,
} from "@/lib/api/whatsapp";

// Per-entity "Message on WhatsApp" action for lead/contact detail, mirroring the
// call buttons. Two ways to send:
//   • Free text, a session message; delivers only inside the recipient's 24h
//     window (Meta rejects it outside that window).
//   • Approved template, a business-initiated message that can start a new
//     conversation even when the 24h window is closed. This is the Meta-compliant
//     way to reach a cold/dormant lead.
export function WhatsAppButton({
  leadId,
  contactId,
  disabled,
}: {
  leadId?: string;
  contactId?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [body, setBody] = React.useState("");
  const [templateKey, setTemplateKey] = React.useState("");

  const { data: templates = [], isLoading: templatesLoading } = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: listWaTemplates,
    enabled: open,
    staleTime: 60_000,
  });
  const approved = templates.filter((t) => t.status === "APPROVED");
  const pendingCount = templates.length - approved.length;
  const selected = approved.find((t) => t.key === templateKey) ?? null;

  const mutation = useMutation({
    mutationFn: (input: SendWhatsAppInput) => sendWhatsApp(input),
    onSuccess: (result: SendWhatsAppResult, input) => {
      setOpen(false);
      setBody("");
      setTemplateKey("");
      if (result.delivered) {
        toast.success("Accepted by WhatsApp.", {
          description: input.templateKey
            ? "Meta queued the approved template."
            : "Meta queued the message. If it doesn't arrive, the recipient is outside the 24h window or not opted in.",
        });
      } else if (result.error) {
        toast.error("WhatsApp rejected the message.", { description: result.error });
      } else {
        toast.success("Message recorded (simulated).", {
          description: "No live WhatsApp account, or simulation mode is on.",
        });
      }
    },
    onError: (e: Error) => toast.error(e.message || "Could not send the message."),
  });

  const sendFreeText = () => mutation.mutate({ leadId, contactId, body: body.trim() });
  const sendTemplate = () => mutation.mutate({ leadId, contactId, templateKey });

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <MessageCircle className="size-4 text-success" />
          WhatsApp
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 space-y-3">
        <p className="text-sm font-medium">Message on WhatsApp</p>

        <Tabs defaultValue="text">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="text">Free text</TabsTrigger>
            <TabsTrigger value="template">Template</TabsTrigger>
          </TabsList>

          {/* Free text, 24h session window only. */}
          <TabsContent value="text" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Delivers only within 24h of their last message to you. Outside that window,
              use an approved template.
            </p>
            <Textarea
              rows={3}
              placeholder="Type your message…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                loading={mutation.isPending}
                disabled={!body.trim()}
                onClick={sendFreeText}
              >
                {mutation.isPending ? null : <Send className="size-4" />} Send
              </Button>
            </div>
          </TabsContent>

          {/* Approved template, can open a fresh conversation any time. */}
          <TabsContent value="template" className="space-y-3 pt-3">
            <p className="text-xs text-muted-foreground">
              Approved templates can start a new conversation even outside the 24h window.
              The lead&apos;s first name fills the template&apos;s first variable.
            </p>

            {templatesLoading ? (
              <p className="text-xs text-muted-foreground">Loading templates…</p>
            ) : approved.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No approved templates yet.
                {pendingCount > 0
                  ? ` ${pendingCount} awaiting Meta approval.`
                  : " Create and sync them in WhatsApp settings."}
              </p>
            ) : (
              <>
                <Select value={templateKey} onValueChange={setTemplateKey}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose an approved template" />
                  </SelectTrigger>
                  <SelectContent>
                    {approved.map((t) => (
                      <SelectItem key={t.id} value={t.key}>
                        {t.key}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {selected ? (
                  <div className="space-y-2 border-t pt-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary" className="text-[10px]">
                        {selected.category}
                      </Badge>
                      {selected.language ? (
                        <Badge variant="outline" className="text-[10px]">
                          {selected.language}
                        </Badge>
                      ) : null}
                      {typeof selected.variables === "number" && selected.variables > 0 ? (
                        <Badge variant="outline" className="text-[10px]">
                          {selected.variables} variable{selected.variables === 1 ? "" : "s"}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground">
                      {selected.body}
                    </p>
                  </div>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    loading={mutation.isPending}
                    disabled={!templateKey}
                    onClick={sendTemplate}
                  >
                    {mutation.isPending ? null : <Send className="size-4" />} Send template
                  </Button>
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  );
}
