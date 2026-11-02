import { runCallsPoll } from "./calls-poll.job";
import { runExotelSync } from "./exotel-sync.job";
import { runCatalogPull } from "./catalog-pull.job";
import { runEngagementRollup } from "./engagement-rollup.job";
import { runWebhookDispatch } from "./webhook-dispatch.job";
import { runHealthSweep } from "./health-sweep.job";
import { runMeetingReminders } from "./meeting-reminders.job";
import { runTaskReminders } from "./task-reminders.job";
import { runBillingPaymentPoll } from "./platform-payment-poll.job";
import { runBillingSweep } from "./platform-subscription-sweep.job";
import { runPaymentsPoll } from "./razorpay-poll.job";
import { runReputationRecovery } from "./reputation-recovery.job";
import { runSalesAgent } from "./sales-agent-runner.job";
import { runVerifyDomains } from "./verify-domains.job";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

export interface ScheduledJob {
  // Stable id, also the BullMQ job-scheduler id + job name. Never change once
  // deployed (it keys the repeatable schedule in Redis).
  name: string;
  everyMs: number;
  handler: () => Promise<void>;
}

// The single source of truth for every recurring sweep. Adding a job = one entry
// here; the scheduler (BullMQ or the interval fallback) picks it up. These are
// all idempotent "find due rows → process" sweeps, so re-running under a durable
// scheduler is safe. (The two SES SQS consumers are NOT here, they are durable
// long-poll consumers with their own lifecycle in jobs/index.ts.)
export const SCHEDULED_JOBS: ScheduledJob[] = [
  { name: "verify-domains", everyMs: 1 * MINUTE, handler: runVerifyDomains },
  { name: "reputation-recovery", everyMs: 10 * MINUTE, handler: runReputationRecovery },
  { name: "health-sweep", everyMs: 24 * HOUR, handler: runHealthSweep },
  { name: "calls-poll", everyMs: 15 * SECOND, handler: runCallsPoll },
  { name: "exotel-sync", everyMs: 30 * SECOND, handler: runExotelSync },
  { name: "meeting-reminders", everyMs: 1 * MINUTE, handler: runMeetingReminders },
  // Hourly sweep; the job self-gates to the configured send hour and is
  // idempotent per day, so at most one reminder email per open task per day.
  { name: "task-reminders", everyMs: 1 * HOUR, handler: runTaskReminders },
  { name: "sales-agent-runner", everyMs: 5 * MINUTE, handler: runSalesAgent },
  { name: "payments-poll", everyMs: 30 * SECOND, handler: runPaymentsPoll },
  { name: "billing-sweep", everyMs: 1 * HOUR, handler: runBillingSweep },
  { name: "billing-payment-poll", everyMs: 30 * SECOND, handler: runBillingPaymentPoll },
  // Refetches PULL-mode product catalogs. Runs every 10 min but the job itself
  // only refreshes feeds older than an hour, so a newly configured app is picked
  // up quickly without hammering every feed on every tick.
  { name: "catalog-pull", everyMs: 10 * MINUTE, handler: runCatalogPull },
  // Recomputes product-intent rollups. Needed because intent DECAYS with
  // time, not only with events: a lead who went quiet must cool down on
  // their own, and no incoming event will ever trigger that.
  { name: "engagement-rollup", everyMs: 15 * MINUTE, handler: runEngagementRollup },
  // Sends queued outbound webhooks. Claim-then-send, so all cluster workers
  // can run it without any delivery going out twice.
  { name: "webhook-dispatch", everyMs: 15 * SECOND, handler: runWebhookDispatch },
];
