import {
  Facebook,
  Github,
  Globe,
  Instagram,
  Link2,
  Linkedin,
  Twitter,
  Youtube,
  type LucideIcon,
} from "lucide-react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

// Canonical "website + common social" set. `key` is what we persist inside the
// record; the array order is the order shown in both the editor and the display.
export interface SocialNetwork {
  key: string;
  label: string;
  icon: LucideIcon;
  placeholder: string;
}

export const SOCIAL_NETWORKS: SocialNetwork[] = [
  { key: "website", label: "Website", icon: Globe, placeholder: "https://acme.com" },
  { key: "linkedin", label: "LinkedIn", icon: Linkedin, placeholder: "linkedin.com/in/…" },
  { key: "twitter", label: "X (Twitter)", icon: Twitter, placeholder: "x.com/…" },
  { key: "instagram", label: "Instagram", icon: Instagram, placeholder: "instagram.com/…" },
  { key: "facebook", label: "Facebook", icon: Facebook, placeholder: "facebook.com/…" },
  { key: "youtube", label: "YouTube", icon: Youtube, placeholder: "youtube.com/@…" },
  { key: "github", label: "GitHub", icon: Github, placeholder: "github.com/…" },
];

const NETWORK_BY_KEY = new Map(SOCIAL_NETWORKS.map((n) => [n.key, n]));

export type SocialsValue = Record<string, string>;

// Make a link openable: prepend https:// when the user typed a bare domain or
// handle. Left untouched when already absolute or a mailto:/tel: link.
export const ensureHref = (raw: string): string => {
  const v = raw.trim();
  if (!v) return v;
  if (/^https?:\/\//i.test(v) || /^(mailto|tel):/i.test(v)) return v;
  return `https://${v}`;
};

// Drop blank fields so we never persist empty strings.
export const cleanSocials = (value: SocialsValue): SocialsValue => {
  const out: SocialsValue = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
};

/** Editable grid of labelled URL inputs, one per network. Fully controlled. */
export function SocialLinksFields({
  value,
  onChange,
}: {
  value: SocialsValue;
  onChange: (next: SocialsValue) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {SOCIAL_NETWORKS.map((net) => {
        const Icon = net.icon;
        return (
          <div key={net.key} className="grid gap-1.5">
            <Label htmlFor={`social-${net.key}`} className="flex items-center gap-1.5">
              <Icon className="size-3.5 text-muted-foreground" />
              {net.label}
            </Label>
            <Input
              id={`social-${net.key}`}
              type="url"
              inputMode="url"
              placeholder={net.placeholder}
              value={value[net.key] ?? ""}
              onChange={(e) => onChange({ ...value, [net.key]: e.target.value })}
            />
          </div>
        );
      })}
    </div>
  );
}

/** Read-only list of the links that are set: each an icon + clickable label. */
export function SocialLinksList({
  socials,
  className,
}: {
  socials: Record<string, string> | null | undefined;
  className?: string;
}) {
  const entries = Object.entries(socials ?? {}).filter(
    ([, v]) => typeof v === "string" && v.trim()
  );
  if (entries.length === 0) return null;
  return (
    <div className={cn("space-y-2", className)}>
      {entries.map(([key, url]) => {
        const net = NETWORK_BY_KEY.get(key);
        const Icon = net?.icon ?? Link2;
        return (
          <a
            key={key}
            href={ensureHref(url)}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-2.5 text-sm text-brand hover:underline"
          >
            <Icon className="size-4 shrink-0" />
            <span className="min-w-0 truncate">{net?.label ?? key}</span>
          </a>
        );
      })}
    </div>
  );
}
