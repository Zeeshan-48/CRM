import config from "../config";
import logger from "../utils/logger";
import { normalizePhone } from "../utils/phone";

export interface WhatsappCreds {
  phoneNumberId: string;
  accessToken: string;
}

export interface WaSendResult {
  // The Meta message id (wamid) on success, null when simulated or failed.
  messageId: string | null;
  simulated: boolean;
  error: string | null;
}

export interface WaValidateResult {
  ok: boolean;
  displayPhoneNumber?: string;
  verifiedName?: string;
  error?: string;
}

// Simulated under tests, or when WHATSAPP_SIMULATE is set, so the whole flow is
// demoable in dev without a Meta account and the suite never calls Meta.
const simulated = (): boolean =>
  config.NODE_ENV === "test" || process.env.VITEST === "true" || config.WHATSAPP_SIMULATE;

// Meta wants the recipient as E.164 digits without the leading "+".
const toWaId = (raw: string | null | undefined): string => normalizePhone(raw).replace(/^\+/, "");

const graphBase = (): string => `https://graph.facebook.com/${config.WHATSAPP_API_VERSION}`;

// Meta seam. Every outbound call to graph.facebook.com funnels through here
// (fixed host, no SSRF surface). Instantiated per send with the resolved
// account's credentials (tenant BYO or platform default). Never throws: callers
// get a structured { error } instead so a failed send is recorded honestly.
class WhatsappClientService {
  isSimulated(): boolean {
    return simulated();
  }

  isDefaultLive(): boolean {
    return Boolean(config.WHATSAPP_API_KEY && config.WHATSAPP_PHONE_NUMBER_ID) && !simulated();
  }

  private keyed(creds: WhatsappCreds): boolean {
    return Boolean(creds.phoneNumberId && creds.accessToken);
  }

  // Confirms the credentials work by fetching the phone number's metadata.
  // Returns ok=false with a message (never throws) so the settings UI can show
  // the reason.
  async validateCredentials(
    phoneNumberId: string,
    accessToken: string
  ): Promise<WaValidateResult> {
    if (simulated()) {
      return { ok: true, displayPhoneNumber: "+1 555 000 0000", verifiedName: "Simulated Sender" };
    }
    if (!phoneNumberId || !accessToken) {
      return { ok: false, error: "Phone number ID and access token are required" };
    }
    try {
      const url = `${graphBase()}/${phoneNumberId}?fields=display_phone_number,verified_name`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = (await res.json()) as {
        display_phone_number?: string;
        verified_name?: string;
        error?: { message?: string };
      };
      if (!res.ok || data.error) {
        return { ok: false, error: data.error?.message ?? `Meta returned ${res.status}` };
      }
      return {
        ok: true,
        displayPhoneNumber: data.display_phone_number,
        verifiedName: data.verified_name,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "validation failed" };
    }
  }

  // ---- Meta Embedded Signup (Tech Provider onboarding) ----

  // True when our platform app is configured to broker Embedded Signup.
  isEmbeddedConfigured(): boolean {
    return Boolean(config.META_APP_ID && config.META_APP_SECRET);
  }

  // Exchange the short-lived OAuth code from the Embedded Signup popup for the
  // tenant's long-lived (never-expiring) access token. Server-to-server, using
  // our app id + secret. No redirect_uri is sent. Never throws.
  async exchangeCode(code: string): Promise<{ accessToken: string | null; error: string | null }> {
    if (simulated()) return { accessToken: `sim_token_${Date.now()}`, error: null };
    if (!this.isEmbeddedConfigured()) {
      return { accessToken: null, error: "Embedded Signup is not configured (META_APP_ID/SECRET)" };
    }
    if (!code) return { accessToken: null, error: "Missing authorization code" };
    try {
      const url =
        `${graphBase()}/oauth/access_token?client_id=${encodeURIComponent(config.META_APP_ID)}` +
        `&client_secret=${encodeURIComponent(config.META_APP_SECRET)}` +
        `&code=${encodeURIComponent(code)}`;
      const res = await fetch(url);
      const data = (await res.json()) as { access_token?: string; error?: { message?: string } };
      if (!res.ok || data.error || !data.access_token) {
        return { accessToken: null, error: data.error?.message ?? `Meta returned ${res.status}` };
      }
      return { accessToken: data.access_token, error: null };
    } catch (err) {
      return { accessToken: null, error: err instanceof Error ? err.message : "token exchange failed" };
    }
  }

  // Fetch WABA metadata with the freshly-exchanged (raw) token.
  async fetchWaba(
    wabaId: string,
    accessToken: string
  ): Promise<{ ok: boolean; name?: string; error?: string }> {
    if (simulated()) return { ok: true, name: "Simulated Business" };
    if (!wabaId || !accessToken) return { ok: false, error: "waba id and token are required" };
    try {
      const url = `${graphBase()}/${wabaId}?fields=id,name,currency,timezone_id`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = (await res.json()) as { name?: string; error?: { message?: string } };
      if (!res.ok || data.error) return { ok: false, error: data.error?.message ?? `Meta returned ${res.status}` };
      return { ok: true, name: data.name };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "waba fetch failed" };
    }
  }

  // Register the phone number for Cloud API with a 6-digit 2FA PIN. Meta's
  // "already registered" codes (133011/133016) are non-fatal. Skipped when
  // simulated. Never throws.
  async registerPhone(
    phoneNumberId: string,
    pin: string,
    accessToken: string
  ): Promise<{ ok: boolean; error?: string }> {
    if (simulated()) return { ok: true };
    try {
      const res = await fetch(`${graphBase()}/${phoneNumberId}/register`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
      const data = (await res.json()) as { error?: { message?: string; code?: number } };
      if (res.ok && !data.error) return { ok: true };
      if (data.error?.code === 133011 || data.error?.code === 133016) return { ok: true };
      return { ok: false, error: data.error?.message ?? `Meta returned ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "register failed" };
    }
  }

  // Subscribe our app to the tenant's WABA so webhook events flow to our shared
  // callback. Best-effort (a retry button / cron recovers it). Never throws.
  async subscribeApp(wabaId: string, accessToken: string): Promise<{ ok: boolean; error?: string }> {
    if (simulated()) return { ok: true };
    try {
      const res = await fetch(`${graphBase()}/${wabaId}/subscribed_apps`, {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as { error?: { message?: string } };
      if (res.ok && !data.error) return { ok: true };
      return { ok: false, error: data.error?.message ?? `Meta returned ${res.status}` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "subscribe failed" };
    }
  }

  // Unsubscribe our app from the WABA on disconnect. Best-effort. Never throws.
  async unsubscribeApp(wabaId: string, accessToken: string): Promise<{ ok: boolean }> {
    if (simulated()) return { ok: true };
    try {
      await fetch(`${graphBase()}/${wabaId}/subscribed_apps`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  // Fetches the tenant's message templates from Meta (the "verified" templates
  // they created in the Meta dashboard), so we know each one's exact language,
  // approval status, and number of body {{n}} variables. Returns [] when
  // simulated or on any error, never throws.
  async fetchTemplates(
    accessToken: string,
    wabaId: string
  ): Promise<
    Array<{
      metaId: string | null;
      name: string;
      language: string;
      status: string;
      category: string;
      variables: number;
      body: string;
    }>
  > {
    if (simulated() || !accessToken || !wabaId) return [];
    try {
      const url = `${graphBase()}/${wabaId}/message_templates?fields=id,name,language,status,category,components&limit=200`;
      const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
      const data = (await res.json()) as {
        data?: Array<{
          id?: string;
          name?: string;
          language?: string;
          status?: string;
          category?: string;
          components?: Array<{ type?: string; text?: string }>;
        }>;
        error?: { message?: string };
      };
      if (!res.ok || data.error || !data.data) {
        logger.warn(`whatsapp fetchTemplates: ${data.error?.message ?? `Meta returned ${res.status}`}`);
        return [];
      }
      return data.data.map((t) => {
        const body = t.components?.find((c) => c.type === "BODY")?.text ?? "";
        // Count distinct {{1}}, {{2}}, … body variables.
        const nums = new Set((body.match(/\{\{\s*(\d+)\s*\}\}/g) ?? []).map((m) => m));
        return {
          metaId: t.id ?? null,
          name: t.name ?? "",
          language: t.language ?? "en_US",
          status: (t.status ?? "PENDING").toUpperCase(),
          category: (t.category ?? "MARKETING").toUpperCase(),
          variables: nums.size,
          body,
        };
      });
    } catch (err) {
      logger.warn(`whatsapp fetchTemplates error: ${String(err)}`);
      return [];
    }
  }

  // Free-form text, only deliverable inside the 24h customer-service window.
  async sendText(params: { creds: WhatsappCreds; to: string; body: string }): Promise<WaSendResult> {
    return this.post(params.creds, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId(params.to),
      type: "text",
      text: { body: params.body, preview_url: false },
    });
  }

  // Approved-template send, required for cold/outside-window messaging. Body
  // params fill the template's positional {{1}}, {{2}}, … variables.
  async sendTemplate(params: {
    creds: WhatsappCreds;
    to: string;
    name: string;
    lang?: string;
    bodyParams?: string[];
  }): Promise<WaSendResult> {
    const components =
      params.bodyParams && params.bodyParams.length
        ? [
            {
              type: "body",
              parameters: params.bodyParams.map((t) => ({ type: "text", text: t })),
            },
          ]
        : undefined;
    return this.post(params.creds, {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toWaId(params.to),
      type: "template",
      template: {
        name: params.name,
        language: { code: params.lang || config.WHATSAPP_DEFAULT_TEMPLATE_LANG },
        ...(components ? { components } : {}),
      },
    });
  }

  // Single funnel for POST /{phone_number_id}/messages.
  private async post(creds: WhatsappCreds, payload: unknown): Promise<WaSendResult> {
    if (simulated() || !this.keyed(creds)) {
      return { messageId: `wamid.sim_${Date.now()}`, simulated: true, error: null };
    }
    try {
      const res = await fetch(`${graphBase()}/${creds.phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as {
        messages?: Array<{ id?: string }>;
        error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string };
      };
      if (!res.ok || data.error) {
        const e = data.error;
        const detail = e
          ? `[${e.code ?? res.status}${e.error_subcode ? `/${e.error_subcode}` : ""}] ${e.message ?? ""}`.trim()
          : `Meta returned ${res.status}`;
        logger.warn(`whatsapp send failed: ${detail}${e?.fbtrace_id ? ` (fbtrace ${e.fbtrace_id})` : ""}`);
        return { messageId: null, simulated: false, error: detail };
      }
      return { messageId: data.messages?.[0]?.id ?? null, simulated: false, error: null };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "send failed";
      logger.warn(`whatsapp send error: ${msg}`);
      return { messageId: null, simulated: false, error: msg };
    }
  }
}

export default new WhatsappClientService();
