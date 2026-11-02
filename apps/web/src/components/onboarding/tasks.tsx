import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays,
  Check,
  ChevronDown,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
} from "lucide-react";
import * as React from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { connectGoogleCalendar } from "@/lib/api/calendar";
import {
  createEmailTemplate,
  listEmailTemplates,
  updateEmailTemplate,
} from "@/lib/api/email";
import {
  createWorkflow,
  updateWorkflow,
  type WorkflowAction,
} from "@/lib/api/workflows";
import { COUNTRIES, DEFAULT_COUNTRY, flagEmoji } from "@/lib/countries";
import type { Country } from "@/lib/countries";
import { updateMyPhone } from "@/lib/api/users";
import { hasModule, useAuthStore } from "@/stores/auth-store";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

import type { OnboardingActionProps, OnboardingContext, OnboardingTask } from "./types";

/** Step 1, save the current user's callback number (used for click-to-call). */
function PhoneAction({ ctx, onDone }: OnboardingActionProps) {
  const patchUser = useAuthStore((s) => s.patchUser);
  const [country, setCountry] = React.useState<Country>(DEFAULT_COUNTRY);
  const [local, setLocal] = React.useState("");
  const [pickerOpen, setPickerOpen] = React.useState(false);

  const digits = local.replace(/\D/g, "");
  const fullNumber = `+${country.dial}${digits}`;
  const canSave = digits.length >= 6;

  const mutation = useMutation({
    mutationFn: () => updateMyPhone(fullNumber),
    onSuccess: (res) => {
      patchUser({ phone: res.phone });
      toast.success("Phone number saved");
      ctx.refresh();
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <form
      className="w-full space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canSave) mutation.mutate();
      }}
    >
      <div className="flex gap-2">
        {/* `modal` keeps the list scrollable inside the Dialog (otherwise the
            Dialog's scroll-lock blocks wheel events on the portaled popover). */}
        <Popover open={pickerOpen} onOpenChange={setPickerOpen} modal>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="flex h-11 shrink-0 items-center gap-1.5 rounded-md border border-input bg-background px-2.5 text-sm transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <span className="text-lg leading-none">
                {flagEmoji(country.iso2)}
              </span>
              <span className="font-medium tabular-nums">+{country.dial}</span>
              <ChevronDown className="size-3.5 text-muted-foreground" />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            sideOffset={8}
            className="w-[288px] overflow-hidden rounded-xl p-0"
          >
            <Command
              filter={(value, search) =>
                value.toLowerCase().includes(search.toLowerCase().trim()) ? 1 : 0
              }
            >
              <CommandInput placeholder="Search country or code…" />
              <CommandList className="max-h-[280px]">
                <CommandEmpty>No country found.</CommandEmpty>
                <CommandGroup heading="Countries">
                  {COUNTRIES.map((c) => {
                    const selected = c.iso2 === country.iso2 && c.dial === country.dial;
                    return (
                      <CommandItem
                        key={`${c.iso2}-${c.dial}`}
                        value={`${c.name} +${c.dial} ${c.iso2}`}
                        onSelect={() => {
                          setCountry(c);
                          setPickerOpen(false);
                        }}
                        className="gap-2.5"
                      >
                        <span className="text-lg leading-none">
                          {flagEmoji(c.iso2)}
                        </span>
                        <span className="flex-1 truncate">{c.name}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          +{c.dial}
                        </span>
                        {selected ? (
                          <Check className="size-4 text-brand" strokeWidth={2.5} />
                        ) : null}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        <Input
          autoFocus
          inputMode="tel"
          placeholder="98765 43210"
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          className="h-11 flex-1 text-base"
        />
      </div>
      <Button
        type="submit"
        className="h-11 w-full"
        loading={mutation.isPending}
        disabled={!canSave}
      >
        Save number
      </Button>
    </form>
  );
}

/** Step 2, connect Google Calendar (full-page OAuth redirect, resumes on return). */
function CalendarAction({ ctx }: OnboardingActionProps) {
  const mutation = useMutation({
    mutationFn: connectGoogleCalendar,
    onSuccess: ({ url }) => {
      // Full-page hand-off to Google. On return to /calendar?calendar=connected
      // the app reloads, the status query refetches, and this step shows as done.
      window.location.href = url;
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="w-full space-y-2.5">
      <Button
        className="h-11 w-full gap-2"
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        Connect Google Calendar
      </Button>
      <p className="text-xs text-muted-foreground">
        You&apos;ll grant access on Google, then land right back here, meeting
        times sync automatically.
      </p>
      {ctx.calendar?.email ? (
        <p className="text-xs text-muted-foreground">
          Connected as {ctx.calendar.email}
        </p>
      ) : null}
    </div>
  );
}

// ---- Step 3, turn on automatic welcome messages for new leads ----

const WELCOME_TRIGGER = "lead.created";
const WELCOME_WF_NAME = "Welcome new leads";
const WELCOME_TEMPLATE_NAME = "Welcome";

// Mirrors DEFAULT_EMAIL_TEMPLATES.welcome in the backend engine.service.ts, so
// the editor is pre-filled with exactly what the engine would otherwise send.
const DEFAULT_WELCOME_SUBJECT = "Welcome aboard";
const DEFAULT_WELCOME_BODY = [
  "Hi {name},",
  "",
  "Welcome, and thanks for your interest. We are glad to have you on board.",
  "",
  "Our team will reach out shortly to understand your goals and show how we can help. In the meantime, reply to this email with any questions and we will get right back to you.",
  "",
  "Warm regards,",
  "The team",
].join("\n");

/** Any automation on the lead-created trigger (reused so we don't stack flows). */
const findLeadCreatedWorkflow = (ctx: OnboardingContext) =>
  (ctx.workflows ?? []).find((w) => w.trigger === WELCOME_TRIGGER);

/** Complete once an active lead-created flow actually sends a welcome email. */
const isWelcomeComplete = (ctx: OnboardingContext): boolean =>
  (ctx.workflows ?? []).some(
    (w) =>
      w.trigger === WELCOME_TRIGGER &&
      w.active &&
      w.actions.some((a) => a.type === "SEND_EMAIL"),
  );

function WelcomeAction({ ctx, onDone }: OnboardingActionProps) {
  const queryClient = useQueryClient();

  // The tenant's saved "Welcome" email template (if any). We upsert this row so
  // the workflow's templateName resolves to the admin's edited content.
  const templatesQuery = useQuery({ queryKey: ["email-templates"], queryFn: listEmailTemplates });
  const existingTemplate = (templatesQuery.data ?? []).find(
    (t) => t.name.toLowerCase() === WELCOME_TEMPLATE_NAME.toLowerCase(),
  );

  const existingWf = findLeadCreatedWorkflow(ctx);
  const existingWaKey =
    (existingWf?.actions.find((a) => a.type === "SEND_WHATSAPP")?.params?.templateKey as
      | string
      | undefined) ?? "";

  const [subject, setSubject] = React.useState(DEFAULT_WELCOME_SUBJECT);
  const [body, setBody] = React.useState(DEFAULT_WELCOME_BODY);
  const [editing, setEditing] = React.useState(false);

  // Seed the editor from a saved template once it loads (leaves the defaults in
  // place when the tenant has none yet).
  React.useEffect(() => {
    if (existingTemplate) {
      setSubject(existingTemplate.subject);
      setBody(existingTemplate.body);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingTemplate?.id]);

  // WhatsApp only counts as ready when the tenant has connected their OWN
  // account (not the shared platform default) AND has an approved template.
  const approvedWa = (ctx.waTemplates ?? []).filter((t) => t.status === "APPROVED" && !!t.meta_id);
  const waUsable = ctx.whatsapp?.status === "ACTIVE" && approvedWa.length > 0;

  // Only pre-fill the picker when the saved key is still an approved template,
  // otherwise the dropdown would render blank.
  const savedWaValid = approvedWa.some((t) => t.key === existingWaKey);
  const [includeWa, setIncludeWa] = React.useState(savedWaValid);
  const [waKey, setWaKey] = React.useState(savedWaValid ? existingWaKey : "");

  const mutation = useMutation({
    mutationFn: async () => {
      // 1. Upsert the "Welcome" email template with the admin's content.
      if (existingTemplate) {
        await updateEmailTemplate(existingTemplate.id, {
          name: existingTemplate.name,
          subject: subject.trim() || DEFAULT_WELCOME_SUBJECT,
          body,
          category: existingTemplate.category ?? undefined,
        });
      } else {
        await createEmailTemplate({
          name: WELCOME_TEMPLATE_NAME,
          subject: subject.trim() || DEFAULT_WELCOME_SUBJECT,
          body,
          category: "ONBOARDING",
        });
      }

      // 2. Build the welcome actions.
      const emailAction: WorkflowAction = {
        type: "SEND_EMAIL",
        params: { templateName: WELCOME_TEMPLATE_NAME },
      };
      const waAction: WorkflowAction | null =
        includeWa && waKey ? { type: "SEND_WHATSAPP", params: { templateKey: waKey } } : null;
      const welcomeActions = waAction ? [emailAction, waAction] : [emailAction];

      // 3. Reuse an existing lead-created flow (preserving its other actions) or
      //    create a fresh one, new workflows are active by default.
      if (existingWf) {
        const kept = existingWf.actions.filter(
          (a) => a.type !== "SEND_EMAIL" && a.type !== "SEND_WHATSAPP",
        );
        await updateWorkflow(existingWf.id, {
          actions: [...kept, ...welcomeActions],
          active: true,
        });
      } else {
        await createWorkflow({
          name: WELCOME_WF_NAME,
          trigger: WELCOME_TRIGGER,
          actions: welcomeActions,
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["workflows"] });
      void queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      toast.success("Welcome messages are on");
      ctx.refresh();
      onDone();
    },
    onError: (error: Error) => toast.error(error.message),
  });

  return (
    <div className="w-full space-y-3 text-left">
      {/* Welcome email, always available (platform sender, built-in fallback). */}
      <div className="border-t pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2 text-sm font-medium">
            <Mail className="size-4 text-brand" />
            Welcome email
          </span>
          <button
            type="button"
            onClick={() => setEditing((e) => !e)}
            className="text-xs font-medium text-brand underline-offset-2 hover:underline"
          >
            {editing ? "Done" : "Edit"}
          </button>
        </div>
        {editing ? (
          <div className="mt-2.5 space-y-2">
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject"
              className="h-9"
            />
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={5}
              className="text-sm"
            />
            <p className="text-[11px] text-muted-foreground">
              Use {"{name}"} and {"{company}"}, they&apos;re filled in for each lead.
            </p>
          </div>
        ) : (
          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{subject}</p>
        )}
      </div>

      {/* WhatsApp, optional, unlocks once WhatsApp is connected + approved. */}
      {waUsable ? (
        <div className="border-t pt-3">
          <label className="flex cursor-pointer items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium">
              <MessageCircle className="size-4 text-brand" />
              Also send on WhatsApp
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Optional
              </span>
            </span>
            <Switch
              checked={includeWa}
              onCheckedChange={(v) => {
                setIncludeWa(v);
                if (v && !waKey) setWaKey(approvedWa[0]?.key ?? "");
              }}
            />
          </label>
          {includeWa ? (
            <Select value={waKey} onValueChange={setWaKey}>
              <SelectTrigger className="mt-2.5 h-9">
                <SelectValue placeholder="Choose a template" />
              </SelectTrigger>
              <SelectContent>
                {approvedWa.map((t) => (
                  <SelectItem key={t.id} value={t.key}>
                    {t.key}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-3">
          <span className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <MessageCircle className="size-4" />
            WhatsApp welcome
          </span>
          <p className="mt-1 text-xs text-muted-foreground">
            Optional,{" "}
            <Link to="/whatsapp" className="text-brand underline-offset-2 hover:underline">
              connect WhatsApp
            </Link>{" "}
            and get a template approved to also greet leads there.
          </p>
        </div>
      )}

      <Button
        type="button"
        className="h-11 w-full"
        loading={mutation.isPending}
        onClick={() => mutation.mutate()}
      >
        {existingWf ? "Update welcome messages" : "Turn on welcome messages"}
      </Button>
      <p className="text-center text-[11px] text-muted-foreground">
        Sent automatically the moment a new lead is added.
      </p>
    </div>
  );
}

/**
 * The ordered list of setup steps. Extend this array to add future onboarding
 * items, the checklist modal renders whatever is here, in order.
 */
export const ONBOARDING_TASKS: OnboardingTask[] = [
  {
    key: "phone",
    title: "Add your phone number",
    description: "So you can call leads and get callbacks.",
    icon: Phone,
    brand: "phone",
    isApplicable: () => true,
    isComplete: (ctx) => !!ctx.user?.phone,
    Action: PhoneAction,
  },
  {
    key: "calendar",
    title: "Connect Google Calendar",
    description: "Block meeting times and sync your availability.",
    icon: CalendarDays,
    // Show the real Google Calendar brand mark instead of a generic icon.
    brand: "google_calendar",
    // Only relevant when the workspace actually has the Google integration
    // configured, otherwise there's nothing the user can connect to.
    isApplicable: (ctx) => ctx.calendar?.available !== false,
    isComplete: (ctx) => !!ctx.calendar?.connected,
    Action: CalendarAction,
  },
  {
    key: "welcome",
    title: "Welcome new leads automatically",
    description: "Greet every new lead with an email (and WhatsApp) the moment they're added.",
    icon: Sparkles,
    // Real brand-style illustration (matches the phone/calendar steps).
    brand: "welcome",
    // Only for admins/managers who can manage automations.
    isApplicable: (ctx) => hasModule(ctx.user, "workflows"),
    isComplete: isWelcomeComplete,
    Action: WelcomeAction,
  },
];
