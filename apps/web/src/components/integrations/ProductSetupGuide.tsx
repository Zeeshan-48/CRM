import { Check, Copy, ExternalLink } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiBaseUrl } from "@/lib/api/client";
import type { ConnectedApp } from "@/lib/api/products";

/**
 * The hand-off page: everything a developer needs to wire this product up, with
 * this workspace's real base URL already filled in.
 *
 * It exists because the person who creates the connected product in the CRM is
 * usually not the person who writes the integration. Without this they email
 * "here's a key" and the developer guesses the rest. Snippets are copyable so the
 * hand-off is a paste, not a transcription.
 */

const Snippet = ({ label, code }: { label: string; code: string }) => {
  const [copied, setCopied] = React.useState(false);
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 px-2 text-xs"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(code);
              setCopied(true);
              window.setTimeout(() => setCopied(false), 2000);
            } catch {
              toast.error("Could not copy. Select the text and copy manually.");
            }
          }}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {/* Wide snippets scroll inside their own box; the sheet never scrolls sideways. */}
      <pre className="overflow-x-auto rounded-lg border bg-muted/50 p-3">
        <code className="font-mono text-xs leading-relaxed">{code}</code>
      </pre>
    </div>
  );
};

const Step = ({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) => (
  <section className="space-y-2.5">
    <h4 className="flex items-center gap-2 text-sm font-semibold">
      <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-brand/10 text-[11px] font-semibold tabular-nums text-brand">
        {n}
      </span>
      {title}
    </h4>
    <div className="space-y-2.5 pl-7">{children}</div>
  </section>
);

export function ProductSetupGuide({ app }: { app: ConnectedApp }) {
  const base = apiBaseUrl.replace(/\/$/, "");
  const ingest = `${base}/ingest`;

  return (
    <div className="space-y-6">
      <div className="border-t pt-3">
        <p className="text-sm">
          Send this to whoever builds the integration. Every snippet below already
          points at this workspace.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge variant="secondary" className="font-mono text-[11px]">
            {ingest}
          </Badge>
          <Badge
            variant="secondary"
            className={
              app.environment === "TEST"
                ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
                : ""
            }
          >
            {app.environment}
          </Badge>
          {app.environment === "TEST" ? (
            <span className="text-xs text-muted-foreground">
              Test keys record events but never affect lead scoring.
            </span>
          ) : null}
        </div>
      </div>

      <Step n={1} title="Get a key">
        <p className="text-sm text-muted-foreground">
          On the <span className="font-medium text-foreground">Keys</span> tab, create
          a <span className="font-mono text-xs">crm_sk_</span> secret key for your
          servers. Add a <span className="font-mono text-xs">crm_pk_</span> publishable
          key only if you also want the browser tracker. A key is shown once.
        </p>
      </Step>

      <Step n={2} title="Push your catalog">
        <p className="text-sm text-muted-foreground">
          So agents quote the right price and know the current offers. Amounts are in
          minor units (paise or cents), sending a bare{" "}
          <span className="font-mono text-xs">amount</span> is refused, because a 100x
          mispricing on an agent's screen is worse than a failed sync.
        </p>
        <Snippet
          label="Sync products"
          code={`curl -X PUT ${ingest}/catalog \\
  -H "Authorization: Bearer crm_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "mode": "UPSERT",
    "products": [{
      "external_id": "plan_712",
      "name": "Pro plan",
      "url": "https://your-product.com/pricing/pro",
      "highlights": ["Unlimited seats", "Priority support"],
      "prices": [
        { "currency": "INR", "amount_minor": 499900, "compare_at_minor": 799900 }
      ]
    }]
  }'`}
        />
      </Step>

      <Step n={3} title="Send what people do">
        <p className="text-sm text-muted-foreground">
          This is what turns the CRM into a second pair of eyes: the agent sees the
          pricing visits and the abandoned checkout before they dial. Use your own
          event names, an unrecognised name is stored and queued for review, never
          dropped.
        </p>
        <Snippet
          label="Record an event"
          code={`curl -X POST ${ingest}/events \\
  -H "Authorization: Bearer crm_sk_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "event": "checkout.started",
    "idempotency_key": "order_5521_started",
    "occurred_at": "${new Date().toISOString()}",
    "identity": { "user_id": "usr_9912", "email": "asha@example.com" },
    "product": { "external_id": "plan_712" },
    "properties": { "value_minor": 499900, "currency": "INR" }
  }'`}
        />
      </Step>

      <Step n={4} title="Track the browser (optional)">
        <p className="text-sm text-muted-foreground">
          Two lines in your page. Visits before anyone logs in are kept and attached
          to the person the moment you identify them, so the agent gets the whole
          story rather than one starting at signup.
        </p>
        <Snippet
          label="Add to your site"
          code={`<script async src="${ingest}/t.js"
  data-crm-key="crm_pk_YOUR_PUBLISHABLE_KEY"></script>

<!-- when they log in or submit a form -->
<script>
  crm.identify({ user_id: "usr_9912", traits: { email: "asha@example.com" } });
</script>`}
        />
        {app.allowed_origins.length === 0 ? (
          <p className="text-xs text-amber-700 dark:text-amber-300">
            Add your site's origin under Settings first, a publishable key only works
            from origins you have allowlisted.
          </p>
        ) : null}
      </Step>

      <Step n={5} title="Check it is working">
        <p className="text-sm text-muted-foreground">
          Answers "is my integration live?" without asking anyone. Reports the last
          24 hours, plus any events that could not be matched to a person and what to
          do about them.
        </p>
        <Snippet
          label="Integration health"
          code={`curl ${ingest}/health \\
  -H "Authorization: Bearer crm_sk_YOUR_KEY"`}
        />
      </Step>

      <div className="flex flex-wrap items-center gap-2 border-t pt-4">
        <Button asChild variant="outline" size="sm">
          <a href={`${ingest}/openapi.json`} target="_blank" rel="noreferrer">
            <ExternalLink className="size-4" />
            OpenAPI spec
          </a>
        </Button>
        <p className="text-xs text-muted-foreground">
          Point a client generator at it. It is served by this deployment, so it can
          never be out of date.
        </p>
      </div>
    </div>
  );
}
