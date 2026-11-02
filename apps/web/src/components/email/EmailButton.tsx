import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Mail, Send, Sparkles } from "lucide-react";
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
  DialogTrigger,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { listEmailTemplates, sendEmail, writeEmail } from "@/lib/api/email";
import { fillTemplate } from "@/lib/email-template";

// Tones offered by the AI generator. These map to the built-in email draft
// types; the free-form brief does the heavy lifting, tone just sets the voice.
const TONES = [
  { value: "sales", label: "Sales outreach" },
  { value: "followup", label: "Follow-up" },
  { value: "meeting", label: "Meeting request" },
  { value: "proposal", label: "Proposal & pricing" },
  { value: "reengage", label: "Re-engagement" },
  { value: "thankyou", label: "Thank you" },
];

/**
 * Per-record "Email" action for the lead/contact detail pages. Opens a modal to
 * either pick an existing template or generate a tailored email with AI, edit
 * it, and send it straight to the record, the backend records it on the
 * timeline, so no separate activity log is needed. Sending works for a lead
 * (leadId) or a contact (contactId).
 */
export function EmailButton({
  leadId,
  contactId,
  recipientName,
  recipientEmail,
  recipientCompany,
}: {
  leadId?: string;
  contactId?: string;
  recipientName: string;
  recipientEmail?: string | null;
  recipientCompany?: string | null;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = React.useState(false);
  const [subject, setSubject] = React.useState("");
  const [body, setBody] = React.useState("");
  const [brief, setBrief] = React.useState("");
  const [tone, setTone] = React.useState("sales");

  const hasEmail = Boolean(recipientEmail && recipientEmail.trim());
  const vars = {
    name: recipientName,
    email: recipientEmail,
    company: recipientCompany,
  };

  const templatesQuery = useQuery({
    queryKey: ["email-templates"],
    queryFn: listEmailTemplates,
    enabled: open,
    staleTime: 60_000,
  });
  const templates = templatesQuery.data ?? [];

  const reset = () => {
    setSubject("");
    setBody("");
    setBrief("");
    setTone("sales");
  };

  const applyTemplate = (id: string) => {
    const t = templates.find((x) => x.id === id);
    if (!t) return;
    // Fill merge fields for a WYSIWYG preview; the backend also substitutes at
    // send time, so pre-filled text is harmless.
    setSubject(fillTemplate(t.subject, vars));
    setBody(fillTemplate(t.body, vars));
  };

  const writeMutation = useMutation({
    mutationFn: writeEmail,
    onSuccess: (draft) => {
      setSubject(fillTemplate(draft.subject, vars));
      setBody(fillTemplate(draft.body, vars));
      toast.success("Draft generated. Review and edit before sending.");
    },
    onError: (e: Error) => toast.error(e.message || "Could not generate the email."),
  });

  const generate = () => {
    if (!brief.trim()) {
      toast.error("Tell the AI what this email is about.");
      return;
    }
    writeMutation.mutate({ type: tone, name: recipientName, brief: brief.trim() });
  };

  const sendMutation = useMutation({
    mutationFn: sendEmail,
    onSuccess: (result) => {
      if (result.provider === "SES") {
        toast.success("Email sent.", {
          description: "It'll appear on this timeline and in your email metrics.",
        });
      } else {
        toast.success("Email sent (simulated).", {
          description: "No email provider is configured, so nothing left the server.",
        });
      }
      if (leadId) queryClient.invalidateQueries({ queryKey: ["lead", leadId] });
      if (contactId) queryClient.invalidateQueries({ queryKey: ["contact", contactId] });
      setOpen(false);
      reset();
    },
    onError: (e: Error) => toast.error(e.message || "Could not send the email."),
  });

  const send = () => {
    if (!hasEmail || !body.trim()) return;
    sendMutation.mutate({
      leadId,
      contactId,
      subject: subject.trim() || undefined,
      body,
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Mail className="size-4" />
          Email
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[88vh] gap-4 overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Email {recipientName}</DialogTitle>
          <DialogDescription>
            {hasEmail ? (
              <>
                To <span className="font-medium text-foreground">{recipientEmail}</span>
              </>
            ) : (
              "No email address on file, add one to this record to send."
            )}
          </DialogDescription>
        </DialogHeader>

        {/* Choose a starting point: an existing template, or an AI draft. */}
        <Tabs defaultValue="template">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="template" className="gap-1.5">
              <FileText className="size-4" />
              Template
            </TabsTrigger>
            <TabsTrigger value="ai" className="gap-1.5">
              <Sparkles className="size-4" />
              Generate with AI
            </TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="pt-3">
            {templatesQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading templates…</p>
            ) : templates.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No templates yet, create them on the Email page, or generate with AI.
              </p>
            ) : (
              <Select onValueChange={applyTemplate}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a template to start from…" />
                </SelectTrigger>
                <SelectContent>
                  {templates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </TabsContent>

          <TabsContent value="ai" className="space-y-3 pt-3">
            <div className="space-y-1.5">
              <Label htmlFor="email-brief">What's this email about?</Label>
              <Textarea
                id="email-brief"
                rows={3}
                placeholder="e.g. Follow up after the demo, propose a 2-week pilot, and mention our analytics dashboard."
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2">
              <Select value={tone} onValueChange={setTone}>
                <SelectTrigger className="h-9 w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TONES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                size="sm"
                onClick={generate}
                loading={writeMutation.isPending}
                disabled={!brief.trim()}
              >
                {writeMutation.isPending ? null : <Sparkles className="size-4" />}
                Generate
              </Button>
            </div>
          </TabsContent>
        </Tabs>

        {/* The email that will actually be sent, always editable. */}
        <div className="space-y-2 border-t pt-3">
          <Input
            placeholder="Subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
          <Textarea
            rows={8}
            placeholder="Write your email, or start from a template / AI above…"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={send}
            loading={sendMutation.isPending}
            disabled={!hasEmail || !body.trim()}
          >
            {sendMutation.isPending ? null : <Send className="size-4" />}
            Send email
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
