// The fixed deal pipeline. Stages are NOT customizable, every tenant gets
// exactly these seven, in this order. "Qualified" is the hand-off point where a
// qualified lead becomes a deal; "Won"/"Lost" are the terminal stages whose
// flags drive deal_status (WON/LOST). This is the single source of truth used
// by tenant provisioning, the create-pipeline API, and the dev seed.
export interface DealStageSpec {
  name: string;
  won: boolean;
  lost: boolean;
}

export const DEAL_STAGES: DealStageSpec[] = [
  { name: "Qualified", won: false, lost: false },
  { name: "Demo Scheduled", won: false, lost: false },
  { name: "Demo Completed", won: false, lost: false },
  { name: "Proposal Sent", won: false, lost: false },
  { name: "Negotiation", won: false, lost: false },
  { name: "Won", won: true, lost: false },
  { name: "Lost", won: false, lost: true },
];

export const DEAL_STAGE_NAMES: string[] = DEAL_STAGES.map((s) => s.name);
