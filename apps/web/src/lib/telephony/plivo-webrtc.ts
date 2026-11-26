import { getWebRTCSession, type WebRTCSession } from "@/lib/api/telephony";

declare global {
  interface Window {
    Plivo?: any;
    plivoWebphoneInstance?: PlivoWebphoneService;
  }
}

export type WebphoneCallState =
  | "UNINITIALIZED"
  | "INITIALIZING"
  | "LOGGED_IN"
  | "LOGIN_FAILED"
  | "CONNECTING"
  | "RINGING"
  | "ACTIVE"
  | "ENDED"
  | "FAILED";

export interface ActiveWebphoneCall {
  callUuid?: string;
  destination: string;
  callerId: string;
  startTime?: Date;
  isMuted: boolean;
}

type CallStateListener = (state: WebphoneCallState, call: ActiveWebphoneCall | null) => void;

class PlivoWebphoneService {
  private client: any = null;
  private state: WebphoneCallState = "UNINITIALIZED";
  private activeCall: ActiveWebphoneCall | null = null;
  private session: WebRTCSession | null = null;
  private listeners = new Set<CallStateListener>();
  private beforeUnloadHandler: ((e: BeforeUnloadEvent) => void) | null = null;
  private loginPromise: Promise<boolean> | null = null;

  constructor() {
    this.setupBeforeUnload();
  }

  private getSipClient() {
    return this.client?.client || this.client;
  }

  public subscribe(listener: CallStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state, this.activeCall);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      listener(this.state, this.activeCall);
    }
  }

  private setState(newState: WebphoneCallState) {
    this.state = newState;
    this.notify();
  }

  public getState(): WebphoneCallState {
    return this.state;
  }

  public getActiveCall(): ActiveWebphoneCall | null {
    return this.activeCall;
  }

  public getSession(): WebRTCSession | null {
    return this.session;
  }

  /**
   * Pre-flight microphone permission check.
   */
  public async checkMicrophone(): Promise<{ ok: boolean; error?: string }> {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return { ok: false, error: "WebRTC and Audio devices are not supported in this browser." };
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Stop the test stream immediately
      stream.getTracks().forEach((track) => track.stop());
      return { ok: true };
    } catch (err: any) {
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        return {
          ok: false,
          error: "Microphone permission is blocked. Please allow microphone access in your browser URL bar.",
        };
      }
      return { ok: false, error: err.message || "Could not access microphone." };
    }
  }

  /**
   * Initialize Plivo WebRTC client with credentials retrieved from CRM backend.
   */
  public async init(): Promise<boolean> {
    const existingSip = this.getSipClient();
    if (this.client && existingSip && (existingSip.isRegistered?.() || existingSip.isLoggedIn)) {
      this.setState("LOGGED_IN");
      return true;
    }

    if (this.loginPromise) {
      return this.loginPromise;
    }

    this.loginPromise = (async () => {
      this.setState("INITIALIZING");

      try {
        // 1. Fetch dynamic WebRTC session from backend API
        const session = await getWebRTCSession();
        this.session = session;

        if (!session.enabled || !session.username || !session.password) {
          this.setState("UNINITIALIZED");
          return false;
        }

        // 2. Check if Plivo Browser SDK is loaded in window
        if (typeof window === "undefined" || !window.Plivo) {
          console.warn("[Webphone] Plivo Browser SDK (plivo.min.js) is not loaded yet.");
          this.setState("UNINITIALIZED");
          return false;
        }

        // 3. Initialize Plivo Client with clean defaults
        if (!this.client) {
          const options = {
            debug: "OFF",
            permAlert: true,
            enableTracking: false,
          };

          this.client = new window.Plivo(options);
          this.bindEvents();
        }

        const sip = this.getSipClient();
        if (!sip) {
          this.setState("FAILED");
          return false;
        }

        // Disable synthetic local ringback tone in Plivo SDK.
        // When ringToneBackFlag is enabled, Plivo pauses remoteView (the callee's voice stream!)
        // and loops a local MP3. Setting it to false lets the telecom carrier's real in-band
        // ringtone play and instantly cuts to two-way voice when the callee answers.
        if (typeof sip.setRingToneBack === "function") {
          sip.setRingToneBack(false);
        }
        if (typeof sip.setConnectTone === "function") {
          sip.setConnectTone(false);
        }

        if (sip.isRegistered?.() || sip.isLoggedIn) {
          this.setState("LOGGED_IN");
          return true;
        }

        // 4. Log in with user credentials and wait for registration
        return await new Promise<boolean>((resolve) => {
          let resolved = false;
          const timer = setTimeout(() => {
            if (!resolved) {
              resolved = true;
              if (sip.isRegistered?.() || sip.isLoggedIn) {
                this.setState("LOGGED_IN");
                resolve(true);
              } else {
                console.warn("[Webphone] Plivo login timed out, continuing in ready state");
                this.setState("LOGGED_IN");
                resolve(true);
              }
            }
          }, 4000);

          const handleLogin = () => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              this.setState("LOGGED_IN");
              resolve(true);
            }
          };

          const handleFailed = (err: any) => {
            if (!resolved) {
              resolved = true;
              clearTimeout(timer);
              console.warn("[Webphone] Login failed during init:", err);
              this.setState("LOGIN_FAILED");
              resolve(false);
            }
          };

          if (typeof sip.once === "function") {
            sip.once("onLogin", handleLogin);
            sip.once("onLoginFailed", handleFailed);
          } else if (typeof sip.on === "function") {
            sip.on("onLogin", handleLogin);
            sip.on("onLoginFailed", handleFailed);
          }

          if (typeof sip.login === "function") {
            sip.login(session.username, session.password);
          } else {
            clearTimeout(timer);
            resolve(false);
          }
        });
      } catch (err) {
        console.error("[Webphone] Failed to initialize Plivo WebRTC client:", err);
        this.setState("LOGIN_FAILED");
        return false;
      } finally {
        this.loginPromise = null;
      }
    })();

    return this.loginPromise;
  }

  /**
   * Helper to ensure synthetic ringback is stopped and real remote audio is active.
   */
  private ensureRemoteAudio() {
    try {
      // 1. Force stop and mute any synthetic ringback audio element so it never loops
      const ringback = document.getElementById("plivo_ringbacktone") as HTMLAudioElement | null;
      if (ringback) {
        ringback.pause();
        ringback.currentTime = 0;
        ringback.muted = true;
      }

      // 2. Unpause and ensure full volume on remote view audio element ONLY if a stream is attached
      const remote = document.getElementById("plivo_webrtc_remoteview") as HTMLAudioElement | null;
      if (remote) {
        remote.muted = false;
        remote.volume = 1.0;
        if (remote.paused && remote.srcObject) {
          remote.play().catch((err) => {
            console.warn("[Webphone] remoteView.play() catch:", err);
          });
        }
      }
    } catch (e) {
      console.warn("[Webphone] ensureRemoteAudio warning:", e);
    }
  }

  private bindEvents() {
    const sip = this.getSipClient();
    if (!sip || typeof sip.on !== "function") return;

    sip.on("onWebrtcNotSupported", () => {
      console.error("[Webphone] WebRTC is not supported in this browser");
      this.setState("FAILED");
    });

    sip.on("onLogin", () => {
      console.log("[Webphone] Registered with Plivo WebRTC gateway as", this.session?.username);
      this.setState("LOGGED_IN");
    });

    sip.on("onLoginFailed", (err: any) => {
      console.warn("[Webphone] Login failed:", err);
      this.setState("LOGIN_FAILED");
    });

    sip.on("onCalling", () => {
      console.log("[Webphone] Dialing outbound call...");
      this.setState("CONNECTING");
    });

    sip.on("onCallRemoteRinging", (callInfo: any) => {
      console.log("[Webphone] Remote phone is ringing 🔔", callInfo);
      this.setState("RINGING");
    });

    sip.on("onCallConnected", (callInfo: any) => {
      console.log("[Webphone] Remote party connected / media signaling established:", callInfo);
      this.ensureRemoteAudio();
    });

    sip.on("onMediaConnected", (callInfo: any) => {
      console.log("[Webphone] WebRTC media stream connected (bidirectional audio live):", callInfo);
      if (this.activeCall) {
        if (!this.activeCall.startTime) {
          this.activeCall.startTime = new Date();
        }
        if (callInfo?.callUUID) {
          this.activeCall.callUuid = callInfo.callUUID;
        }
      }
      this.ensureRemoteAudio();
      this.setState("ACTIVE");
    });

    sip.on("remoteAudioStatus", (hasAudio: boolean) => {
      console.log("[Webphone] Remote audio status:", hasAudio);
      if (hasAudio) {
        this.ensureRemoteAudio();
        this.setState("ACTIVE");
      }
    });

    sip.on("onCallAnswered", (callInfo: any) => {
      console.log("[Webphone] Call answered:", callInfo);
      if (this.activeCall) {
        this.activeCall.startTime = new Date();
        if (callInfo?.callUUID) {
          this.activeCall.callUuid = callInfo.callUUID;
        }
      }
      this.ensureRemoteAudio();
      this.setState("ACTIVE");
    });

    sip.on("onCallTerminated", (callInfo: any) => {
      console.log("[Webphone] Call terminated:", callInfo);
      this.ensureRemoteAudio();
      this.cleanupCall();
      this.setState("ENDED");
      setTimeout(() => {
        if (this.state === "ENDED") {
          this.setState("LOGGED_IN");
        }
      }, 250);
    });

    sip.on("onCallFailed", (err: any) => {
      console.warn("[Webphone] Call failed from Plivo gateway:", err);
      this.ensureRemoteAudio();
      this.cleanupCall();
      this.setState("FAILED");
      setTimeout(() => {
        if (this.state === "FAILED") {
          this.setState("LOGGED_IN");
        }
      }, 3000);
    });
  }

  /**
   * Make a pure in-browser outbound WebRTC call to a phone number.
   */
  public async makeCall(destinationNumber: string, callId?: string): Promise<{ ok: boolean; error?: string }> {
    // 1. Check microphone permission
    const micCheck = await this.checkMicrophone();
    if (!micCheck.ok) {
      return { ok: false, error: micCheck.error };
    }

    // 2. Ensure client is initialized and logged in
    const sip = this.getSipClient();
    if (!this.client || (!sip?.isLoggedIn && !sip?.isRegistered?.() && this.state !== "LOGGED_IN")) {
      const initialized = await this.init();
      if (!initialized) {
        return {
          ok: false,
          error: "Softphone is not registered with Plivo. Please check your network connection.",
        };
      }
    }

    // 3. Auto-normalize destination number (e.g. 10 digits -> +91)
    let formattedNumber = destinationNumber.trim();
    if (/^\d{10}$/.test(formattedNumber)) {
      formattedNumber = `+91${formattedNumber}`;
    } else if (/^91\d{10}$/.test(formattedNumber)) {
      formattedNumber = `+${formattedNumber}`;
    } else if (!formattedNumber.startsWith("+") && /^\d+$/.test(formattedNumber)) {
      formattedNumber = `+${formattedNumber}`;
    }

    const callerId = this.session?.callerId || "+918065395632";

    try {
      this.activeCall = {
        destination: formattedNumber,
        callerId,
        isMuted: false,
      };
      this.setState("CONNECTING");

      const extraHeaders: Record<string, string> = {
        "X-PH-callerId": callerId,
      };
      if (callId) {
        extraHeaders["X-PH-callId"] = callId;
      }

      console.log(`[Webphone] Initiating WebRTC call to ${formattedNumber} with callerId ${callerId}, callId: ${callId}`);
      const clientSip = this.getSipClient();
      if (clientSip && typeof clientSip.setRingToneBack === "function") {
        clientSip.setRingToneBack(false);
      }
      this.ensureRemoteAudio();

      const callResult = clientSip.call(formattedNumber, extraHeaders);
      console.log("[Webphone] sip.call response:", callResult);

      if (callResult === false) {
        this.cleanupCall();
        this.setState(this.session ? "LOGGED_IN" : "UNINITIALIZED");
        return {
          ok: false,
          error: "Plivo softphone could not connect outbound call. Please refresh the page and try again.",
        };
      }

      if (this.activeCall && typeof callResult === "string") {
        this.activeCall.callUuid = callResult;
      }
      return { ok: true };
    } catch (err: any) {
      console.error("[Webphone] makeCall error:", err);
      this.cleanupCall();
      this.setState("LOGGED_IN");
      return { ok: false, error: err.message || "Failed to initiate in-browser call." };
    }
  }

  /**
   * Hang up the active call.
   */
  public hangup() {
    try {
      const sip = this.getSipClient();
      if (sip && typeof sip.hangup === "function") {
        sip.hangup();
      }
    } catch (err) {
      console.warn("[Webphone] Error hanging up call:", err);
    } finally {
      this.ensureRemoteAudio();
      this.cleanupCall();
      this.setState(this.session ? "LOGGED_IN" : "UNINITIALIZED");
    }
  }

  /**
   * Mute or unmute microphone.
   */
  public toggleMute(): boolean {
    const sip = this.getSipClient();
    if (!sip || !this.activeCall) return false;
    try {
      if (this.activeCall.isMuted) {
        sip.unmute();
        this.activeCall.isMuted = false;
      } else {
        sip.mute();
        this.activeCall.isMuted = true;
      }
      this.notify();
      return this.activeCall.isMuted;
    } catch (err) {
      console.warn("[Webphone] Error toggling mute:", err);
      return false;
    }
  }

  /**
   * Send DTMF tone (keypad digit).
   */
  public sendDTMF(digit: string) {
    const sip = this.getSipClient();
    if (!sip || !this.activeCall) return;
    try {
      sip.sendDigits(digit);
    } catch (err) {
      console.warn("[Webphone] Error sending DTMF:", err);
    }
  }

  private cleanupCall() {
    this.activeCall = null;
    this.ensureRemoteAudio();
  }

  private setupBeforeUnload() {
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this.activeCall && this.state === "ACTIVE") {
        e.preventDefault();
        e.returnValue = "You have an active call in progress. Closing this page will disconnect the call.";
      }
    };
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }
}

export const plivoWebphone = new PlivoWebphoneService();
if (typeof window !== "undefined") {
  window.plivoWebphoneInstance = plivoWebphone;
}
