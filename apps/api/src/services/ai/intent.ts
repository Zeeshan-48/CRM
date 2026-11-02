// Product-intent scoring: turns a raw event stream into a number an agent can
// act on, plus the plain-English reasons behind it.
//
// Pure by design. No I/O, `now` injectable. A score an agent cannot interrogate
// is a score they learn to ignore, so `reasons` is a first-class output rather
// than a debugging afterthought.

export const INTENT_WINDOW_DAYS = 30;

/**
 * Half-life of an event's contribution, in days.
 *
 * 14 days chosen so a strong signal (checkout started, weight 60) still carries
 * meaningful weight a fortnight later (30) but is nearly spent after six weeks
 * (~7). Straight recency cliffs make the score jump the moment an event crosses
 * the boundary; exponential decay makes it drift, which reads as sane to an
 * agent watching the same lead over time.
 */
export const INTENT_HALF_LIFE_DAYS = 14;

/**
 * Saturation constant for mapping an unbounded weight sum onto 0-100.
 *
 * A linear map would let one enormous day peg the score at 100 forever, and a
 * hard cap would make every engaged lead look identical. Saturating means more
 * signal always helps but with diminishing returns:
 *   sum  60 -> 39,  120 -> 63,  240 -> 86,  360 -> 95
 */
const SATURATION = 120;

/** An unresolved abandoned checkout is worth a call regardless of what else
 * happened, so it is added to the raw sum rather than being just another event. */
const ABANDONED_CHECKOUT_BONUS = 25;

export const HOT_THRESHOLD = 70;
export const WARM_THRESHOLD = 40;

export type IntentBand = "HOT" | "WARM" | "COLD";

export interface IntentEvent {
  event: string;
  /** The definition's label, used verbatim in reasons. */
  label?: string | null;
  occurred_at: Date | string;
  /** intent_weight from app_event_definitions, -100..100. */
  weight: number;
}

export interface IntentReason {
  label: string;
  weight: number;
  count: number;
}

export interface IntentResult {
  score: number;
  band: IntentBand;
  reasons: IntentReason[];
}

export const bandFor = (score: number): IntentBand =>
  score >= HOT_THRESHOLD ? "HOT" : score >= WARM_THRESHOLD ? "WARM" : "COLD";

/** Decay multiplier for an event of a given age. 1.0 at t=0, 0.5 at one half-life. */
export const decayFactor = (ageMs: number): number => {
  if (ageMs <= 0) return 1;
  const ageDays = ageMs / 86_400_000;
  return 0.5 ** (ageDays / INTENT_HALF_LIFE_DAYS);
};

const prettyEvent = (name: string): string => {
  const [entity, action] = name.split(".");
  const label = `${entity ?? ""} ${(action ?? "").replace(/_/g, " ")}`.trim();
  return label ? label.charAt(0).toUpperCase() + label.slice(1) : name;
};

/**
 * Computes the product-intent score for one person on one connected product.
 *
 * Events outside the window are ignored entirely rather than decayed to near
 * zero, so the query that feeds this can be bounded.
 */
export const computeIntent = (
  events: IntentEvent[],
  options: { checkoutAbandoned?: boolean } = {},
  now = Date.now()
): IntentResult => {
  const cutoff = now - INTENT_WINDOW_DAYS * 86_400_000;

  // Group by event name so the reasons read as "Viewed pricing x6", not six
  // separate identical lines.
  const grouped = new Map<string, { label: string; weight: number; count: number }>();
  let sum = 0;

  for (const e of events) {
    const at = new Date(e.occurred_at).getTime();
    if (Number.isNaN(at) || at < cutoff || at > now) continue;
    if (!Number.isFinite(e.weight) || e.weight === 0) continue;

    const contribution = e.weight * decayFactor(now - at);
    sum += contribution;

    const key = e.event;
    const current = grouped.get(key);
    if (current) {
      current.weight += contribution;
      current.count += 1;
    } else {
      grouped.set(key, {
        label: e.label || prettyEvent(e.event),
        weight: contribution,
        count: 1,
      });
    }
  }

  if (options.checkoutAbandoned) {
    sum += ABANDONED_CHECKOUT_BONUS;
    grouped.set("__abandoned__", {
      label: "Started checkout, did not finish",
      weight: ABANDONED_CHECKOUT_BONUS,
      count: 1,
    });
  }

  const score = sum <= 0 ? 0 : Math.round(100 * (1 - Math.exp(-sum / SATURATION)));

  // Strongest contributors first, and only the ones that actually pushed the
  // score up. A reason list that includes negatives reads as contradictory next
  // to a high score.
  const reasons = Array.from(grouped.values())
    .filter((r) => r.weight > 0)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((r) => ({ label: r.label, weight: Math.round(r.weight), count: r.count }));

  return { score, band: bandFor(score), reasons };
};

/**
 * Folds the product-intent score into the existing CRM lead score.
 *
 * The rule is "the higher of the two signals wins", not a weighted average.
 *
 * A weighted blend was the obvious first design and it is wrong, because the two
 * signals measure different things and each is legitimately absent. A lead who
 * viewed pricing three times and abandoned a checkout scores 81 on product and
 * near-zero on the CRM dimensions, for the simple reason that NOBODY HAS CALLED
 * THEM YET. Averaging graded that lead COLD and buried the hottest person in the
 * workspace. The mirror case is just as bad: a lead deep in email conversations
 * who never touches the product would be dragged down by a zero.
 *
 * Taking the max fixes both, is trivially explainable to an agent ("your score
 * is the higher of how they engage with your team and how they behave in the
 * product"), and preserves the original formula exactly when there is no product
 * data, so a workspace without an integration sees the grades it always saw.
 */
export const blendLeadScore = (
  base: { interest: number; intent: number; engagement: number; risk: number },
  product: number | null
): { total: number; grade: "HOT" | "WARM" | "COLD" } => {
  const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

  const crm = clamp(
    base.interest * 0.3 + base.intent * 0.4 + base.engagement * 0.3 - base.risk * 0.15
  );

  const total = product === null ? crm : Math.max(crm, clamp(product));
  const grade = total >= 75 ? "HOT" : total >= 50 ? "WARM" : "COLD";
  return { total, grade };
};
