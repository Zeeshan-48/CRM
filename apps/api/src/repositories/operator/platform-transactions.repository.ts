import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { platform_txn_kind, platform_txn_status } from "../../db/enums";
import type { platform_transactions } from "../../db/types";

export type PlatformTransactionRow = Selectable<platform_transactions>;

export interface CreateTransactionData {
  tenantId: string;
  subscriptionId: string;
  gateway: string;
  gatewayInvoiceId: string | null;
  gatewayPaymentId: string | null;
  amount: number;
  currency: string;
  status: platform_txn_status;
  kind: platform_txn_kind;
  periodStart: Date | null;
  periodEnd: Date | null;
  hostedInvoiceUrl: string | null;
  failureReason: string | null;
  occurredAt: Date;
}

class PlatformTransactionsRepository {
  async listByTenant(tenantId: string): Promise<PlatformTransactionRow[]> {
    return db
      .selectFrom("platform_transactions")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("occurred_at", "desc")
      .limit(200)
      .execute();
  }

  async findByGatewayInvoiceId(
    gatewayInvoiceId: string
  ): Promise<PlatformTransactionRow | undefined> {
    return db
      .selectFrom("platform_transactions")
      .selectAll()
      .where("gateway_invoice_id", "=", gatewayInvoiceId)
      .executeTakeFirst();
  }

  async create(data: CreateTransactionData): Promise<PlatformTransactionRow> {
    const t = new Date();
    return db
      .insertInto("platform_transactions")
      .values({
        id: ulid(),
        tenant_id: data.tenantId,
        subscription_id: data.subscriptionId,
        gateway: data.gateway,
        gateway_invoice_id: data.gatewayInvoiceId,
        gateway_payment_id: data.gatewayPaymentId,
        amount: data.amount,
        currency: data.currency,
        status: data.status,
        kind: data.kind,
        period_start: data.periodStart,
        period_end: data.periodEnd,
        hosted_invoice_url: data.hostedInvoiceUrl,
        failure_reason: data.failureReason,
        occurred_at: data.occurredAt,
        created_at: t,
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }
}

export default new PlatformTransactionsRepository();
