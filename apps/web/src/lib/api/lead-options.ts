import { apiGet } from "./client";

/** A lead as offered in pickers (compose, call log, deal forms). */
export interface LeadOption {
  id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
}

/** Leads for pickers. The endpoint returns a paginated envelope. */
export const listLeadOptions = () =>
  apiGet<{ leads: LeadOption[] }>("/leads", { params: { limit: 100 } }).then(
    (result) => result.leads
  );
