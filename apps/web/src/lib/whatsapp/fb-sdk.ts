// Loads the Facebook JS SDK on demand and runs the WhatsApp Embedded Signup
// ("Connect with Facebook") flow. The tenant connects THEIR OWN WABA + number
// inside Meta's popup; we only capture the OAuth code + session ids and hand
// them to the backend for the server-side token exchange.

const GRAPH_VERSION =
  (import.meta.env.VITE_META_GRAPH_API_VERSION as string | undefined) || "v25.0";

interface FBAuthResponse {
  code?: string;
}
interface FBLoginResponse {
  status?: string;
  authResponse?: FBAuthResponse;
}
interface FacebookSdk {
  init(params: Record<string, unknown>): void;
  login(cb: (r: FBLoginResponse) => void, opts: Record<string, unknown>): void;
}

declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}

export const metaAppId = (): string =>
  (import.meta.env.VITE_META_APP_ID as string | undefined) || "";
export const metaConfigId = (): string =>
  (import.meta.env.VITE_META_WA_ES_CONFIG_ID as string | undefined) || "";
export const isEmbeddedSignupConfigured = (): boolean => Boolean(metaAppId() && metaConfigId());

let loadPromise: Promise<FacebookSdk> | null = null;

// Idempotent SDK loader (module-level promise; early-return if already present).
export function loadFacebookSdk(): Promise<FacebookSdk> {
  if (typeof window === "undefined") return Promise.reject(new Error("No window"));
  if (window.FB) return Promise.resolve(window.FB);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<FacebookSdk>((resolve, reject) => {
    const appId = metaAppId();
    if (!appId) {
      reject(new Error("VITE_META_APP_ID is not set"));
      return;
    }
    window.fbAsyncInit = () => {
      window.FB?.init({ appId, cookie: true, xfbml: false, version: GRAPH_VERSION });
      if (window.FB) resolve(window.FB);
      else reject(new Error("Facebook SDK failed to initialise"));
    };
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => reject(new Error("Failed to load the Facebook SDK"));
    document.body.appendChild(script);
  });
  return loadPromise;
}

export interface EmbeddedSignupResult {
  code: string;
  wabaId: string;
  phoneNumberId: string;
  businessId?: string;
}

const isMetaOrigin = (origin: string): boolean => {
  try {
    const host = new URL(origin).hostname;
    return host === "facebook.com" || host.endsWith(".facebook.com");
  } catch {
    return false;
  }
};

// Opens the Embedded Signup popup and resolves with the merged result of Meta's
// two channels: the postMessage session info (waba_id / phone_number_id) and the
// FB.login OAuth code.
export async function launchEmbeddedSignup(): Promise<EmbeddedSignupResult> {
  const fb = await loadFacebookSdk();
  const configId = metaConfigId();
  if (!configId) throw new Error("VITE_META_WA_ES_CONFIG_ID is not set");

  return new Promise<EmbeddedSignupResult>((resolve, reject) => {
    let session: { wabaId?: string; phoneNumberId?: string; businessId?: string } = {};

    const onMessage = (event: MessageEvent) => {
      if (!isMetaOrigin(event.origin) || typeof event.data !== "string") return;
      try {
        const parsed = JSON.parse(event.data) as {
          type?: string;
          event?: string;
          data?: { waba_id?: string; phone_number_id?: string; business_id?: string };
        };
        if (parsed.type !== "WA_EMBEDDED_SIGNUP") return;
        if (typeof parsed.event === "string" && parsed.event.startsWith("FINISH")) {
          session = {
            wabaId: parsed.data?.waba_id,
            phoneNumberId: parsed.data?.phone_number_id,
            businessId: parsed.data?.business_id,
          };
        }
      } catch {
        // ignore non-JSON postMessages
      }
    };
    window.addEventListener("message", onMessage);

    fb.login(
      (response) => {
        window.removeEventListener("message", onMessage);
        const code = response?.authResponse?.code;
        if (response?.status !== "connected" || !code) {
          reject(new Error("Connection was cancelled"));
          return;
        }
        if (!session.wabaId || !session.phoneNumberId) {
          reject(new Error("Meta did not return the WhatsApp account details"));
          return;
        }
        resolve({
          code,
          wabaId: session.wabaId,
          phoneNumberId: session.phoneNumberId,
          businessId: session.businessId,
        });
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: { setup: {}, featureType: "", sessionInfoVersion: "3" },
      }
    );
  });
}
