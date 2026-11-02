import type { operator_role, tenant_status, user_status } from "../db/enums";

declare global {
  namespace Express {
    interface Request {
      authUser?: {
        id: string;
        tenantId: string;
        name: string;
        email: string;
        role: string;
        permissions: string[] | null;
        status: user_status;
      };
      tenantId?: string;
      // Inbound API-key auth context. Populated only by authenticateApiKey on the
      // public /ingest routes; independent of the tenant JWT authUser above.
      // Every key resolves to exactly one connected app: legacy keys (app_id
      // NULL) are bound to the tenant's auto-created "Default product" on first
      // use, so appId is always present here.
      apiKey?: {
        id: string;
        tenantId: string;
        createdBy: string | null;
        name: string;
        appId: string;
        appKey: string;
        appName: string;
        // SECRET keys reach the whole ingest surface; PUBLISHABLE keys ship in
        // browser JS and are limited to track / page / identify.
        scope: "SECRET" | "PUBLISHABLE";
        // TEST-environment traffic is ingested but excluded from lead scoring.
        environment: "LIVE" | "TEST";
      };
      tenant?: {
        id: string;
        slug: string;
        name: string;
        status: tenant_status;
        brandColor: string;
        config: Record<string, unknown> | null;
      };
      // Operator console (platform tier) auth context. Populated only by the
      // operator auth middleware on /api/v1/operator routes; independent of the
      // tenant authUser above.
      operatorUser?: {
        id: string;
        email: string;
        name: string;
        role: operator_role;
      };
    }
  }
}

export {};
