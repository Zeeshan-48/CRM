import type { BillingMode, MyBilling, PlatformTransaction, Subscription } from "@/types";
import { apiGet, apiPost } from "./client";

// This workspace's own subscription with the platform operator (tenant self-service billing).
export const getMyBilling = () => apiGet<MyBilling>("/billing");

export const listMyTransactions = () => apiGet<PlatformTransaction[]>("/billing/transactions");

// Returns a hosted URL to pay the current/next cycle (manual billing or a
// pending mandate setup). Null when nothing is payable (auto-renew active).
export const payMyBilling = () => apiPost<{ url: string | null }>("/billing/pay");

// Turns auto-renew on/off. Returns the subscription and, for MANUAL->AUTO, the
// mandate authorization URL to complete.
export const setMyBillingMode = (mode: BillingMode) =>
  apiPost<{ subscription: Subscription; url: string | null }>("/billing/mode", { mode });
