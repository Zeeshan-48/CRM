// The browser tracker, served as JavaScript from GET /api/v1/ingest/t.js.
//
// Held as a string constant rather than a static .js file on purpose: `tsc`
// compiles src -> dist and does not copy non-TS assets, so a static file would
// build fine locally and 404 in production.
//
// Usage in a product's page:
//   <script async src="https://crm.example.com/api/v1/ingest/t.js"
//           data-crm-key="crm_pk_..."></script>
//
// It carries a PUBLISHABLE key, which is public by construction. The origin
// allowlist on the connected product is what makes that safe, and a publishable
// key can only reach track / page / identify.

export const TRACKER_VERSION = "1.0.0";

export const TRACKER_SCRIPT = `(function () {
  "use strict";
  if (window.crm && window.crm.__loaded) return;

  var script = document.currentScript;
  var key = script && script.getAttribute("data-crm-key");
  var endpoint = (script && script.getAttribute("data-crm-endpoint")) ||
    (script && script.src ? script.src.replace(/\\/t\\.js.*$/, "") : "");
  // A tracker with no key is a no-op rather than an error: a half-finished
  // snippet must never break the host page.
  if (!key || !endpoint) return;

  var AUTO = (script.getAttribute("data-crm-auto") || "true") !== "false";
  // Consent defaults to granted; a product behind a cookie banner sets
  // data-crm-consent="false" and calls crm.consent(true) once given.
  var consent = (script.getAttribute("data-crm-consent") || "true") !== "false";
  // Do Not Track is honoured without needing configuration.
  var dnt = navigator.doNotTrack === "1" || window.doNotTrack === "1";

  var ANON_KEY = "crm_anon_id";
  var SESSION_KEY = "crm_session";
  var SESSION_TTL = 30 * 60 * 1000;
  var queue = [];
  var flushing = false;

  function uid() {
    try {
      if (window.crypto && window.crypto.randomUUID) return "a_" + window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return "a_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  function store(k, v) {
    try { window.localStorage.setItem(k, v); } catch (e) { /* private mode */ }
  }
  function read(k) {
    try { return window.localStorage.getItem(k); } catch (e) { return null; }
  }

  function anonymousId() {
    var id = read(ANON_KEY);
    if (!id) { id = uid(); store(ANON_KEY, id); }
    return id;
  }

  // A session is a run of activity with no 30-minute gap. Rolled forward on
  // every event so an active visitor stays in one session.
  function sessionId() {
    var now = Date.now();
    var raw = read(SESSION_KEY);
    var parsed = null;
    if (raw) { try { parsed = JSON.parse(raw); } catch (e) { parsed = null; } }
    var isNew = !parsed || !parsed.id || (now - (parsed.at || 0)) > SESSION_TTL;
    var id = isNew ? "s_" + now.toString(36) + Math.random().toString(36).slice(2, 8) : parsed.id;
    store(SESSION_KEY, JSON.stringify({ id: id, at: now }));
    return { id: id, isNew: isNew };
  }

  function idempotencyKey() {
    return "e_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
  }

  function context(session) {
    return {
      anonymous_id: anonymousId(),
      session_id: session.id,
      page_url: location.href,
      referrer: document.referrer || null,
      title: document.title || null
    };
  }

  function post(path, body) {
    if (!consent || dnt) return;
    var url = endpoint + path;
    var payload = JSON.stringify(body);
    // sendBeacon survives a page unload, which is exactly when the last and
    // most interesting page view fires. Falls back to fetch when unavailable.
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "application/json" });
        // Beacon cannot set an Authorization header, so the key rides in the
        // query string for this path only.
        if (navigator.sendBeacon(url + "?k=" + encodeURIComponent(key), blob)) return;
      }
    } catch (e) { /* fall through to fetch */ }

    try {
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-API-Key": key },
        body: payload,
        keepalive: true,
        credentials: "omit"
      }).catch(function () { /* never surface a tracking failure to the page */ });
    } catch (e) { /* ignore */ }
  }

  function flush() {
    if (flushing) return;
    flushing = true;
    while (queue.length) {
      var item = queue.shift();
      post(item.path, item.body);
    }
    flushing = false;
  }

  function enqueue(path, body) {
    queue.push({ path: path, body: body });
    flush();
  }

  var crm = {
    __loaded: true,
    version: "${TRACKER_VERSION}",

    /** Grants or withdraws consent at runtime (cookie banners). */
    consent: function (granted) {
      consent = granted !== false;
      if (consent) flush();
    },

    /** Records a named event with optional properties. */
    track: function (event, properties) {
      if (!event) return;
      var session = sessionId();
      enqueue("/events", {
        event: String(event),
        occurred_at: new Date().toISOString(),
        idempotency_key: idempotencyKey(),
        identity: { anonymous_id: anonymousId() },
        properties: properties || {},
        context: context(session)
      });
    },

    /** Records a page view. Called automatically unless auto is disabled. */
    page: function (name, properties) {
      var session = sessionId();
      // A brand-new session is worth its own event: it is the unit sessions_30d
      // counts, and inferring it server-side from gaps would be guesswork.
      if (session.isNew) {
        enqueue("/events", {
          event: "session.started",
          occurred_at: new Date().toISOString(),
          idempotency_key: idempotencyKey(),
          identity: { anonymous_id: anonymousId() },
          properties: {},
          context: context(session)
        });
      }
      var props = properties || {};
      if (name) props.name = String(name);
      props.path = location.pathname;
      enqueue("/events", {
        event: "page.viewed",
        occurred_at: new Date().toISOString(),
        idempotency_key: idempotencyKey(),
        identity: { anonymous_id: anonymousId() },
        properties: props,
        context: context(session)
      });
    },

    /**
     * Binds this browser to a known person. Everything tracked anonymously
     * before this call is claimed retroactively by the CRM.
     */
    identify: function (userId, traits) {
      enqueue("/identify", {
        user_id: userId ? String(userId) : undefined,
        anonymous_id: anonymousId(),
        traits: traits || {}
      });
    },

    /** Clears the anonymous identity. Call on sign-out, on a shared device. */
    reset: function () {
      store(ANON_KEY, uid());
      store(SESSION_KEY, "");
    }
  };

  // Replay anything the page queued before the script finished loading, the
  // standard async-snippet pattern.
  var pending = window.crm && window.crm.q;
  window.crm = crm;
  if (pending && pending.length) {
    for (var i = 0; i < pending.length; i++) {
      try {
        var call = pending[i];
        if (crm[call[0]]) crm[call[0]].apply(crm, call.slice(1));
      } catch (e) { /* one bad queued call must not stop the rest */ }
    }
  }

  if (AUTO) {
    crm.page();

    // Single-page apps change the URL without a load event, so patch history
    // and listen for popstate. Without this a SPA reports exactly one page view
    // per session, which is worse than none because it looks like real data.
    var lastPath = location.href;
    var report = function () {
      if (location.href === lastPath) return;
      lastPath = location.href;
      crm.page();
    };
    ["pushState", "replaceState"].forEach(function (method) {
      var original = history[method];
      if (typeof original !== "function") return;
      history[method] = function () {
        var result = original.apply(this, arguments);
        setTimeout(report, 0);
        return result;
      };
    });
    window.addEventListener("popstate", report);
  }
})();`;
