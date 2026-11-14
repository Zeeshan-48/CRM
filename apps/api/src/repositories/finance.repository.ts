import { Selectable, sql, Transaction } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, invoices, payments } from "../db/types";
import type { invoice_status, payment_status } from "../db/enums";

export type InvoiceRow = Selectable<invoices>;
export type PaymentRow = Selectable<payments>;
export type InvoiceWithAccountRow = InvoiceRow & {
  account: string | null;
  contact: string | null;
};

export interface FinanceSummary {
  revenue: number;
  invoiced: number;
  paid: number;
  pending: number;
  tax: number;
}

export interface CreateInvoiceData {
  tenant_id: string;
  number: string;
  deal_id?: string | null;
  account_id?: string | null;
  contact_id?: string | null;
  amount: number;
  tax: number;
  gateway?: string | null;
  due_at?: Date | null;
  details?: unknown;
}

export interface UpdateInvoiceData {
  amount?: number;
  tax?: number;
  due_at?: Date | null;
  gateway?: string | null;
  deal_id?: string | null;
  account_id?: string | null;
  contact_id?: string | null;
  details?: unknown;
}

export interface CreatePaymentData {
  id?: string;
  tenant_id: string;
  invoice_id: string;
  amount: number;
  status: payment_status;
  gateway?: string | null;
  reference: string;
  pay_url?: string | null;
  gateway_payment_id?: string | null;
}

class FinanceRepository {
  async summary(tenantId: string): Promise<FinanceSummary> {
    const row = await db
      .selectFrom("invoices")
      .select([
        sql<string>`coalesce(sum(amount + tax) filter (where status = 'PAID'), 0)`.as("revenue"),
        sql<string>`count(*)`.as("invoiced"),
        sql<string>`count(*) filter (where status = 'PAID')`.as("paid"),
        sql<string>`count(*) filter (where status in ('SENT', 'OVERDUE'))`.as("pending"),
        sql<string>`coalesce(sum(tax) filter (where status = 'PAID'), 0)`.as("tax"),
      ])
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return {
      revenue: Number(row?.revenue ?? 0),
      invoiced: Number(row?.invoiced ?? 0),
      paid: Number(row?.paid ?? 0),
      pending: Number(row?.pending ?? 0),
      tax: Number(row?.tax ?? 0),
    };
  }

  async listInvoices(tenantId: string): Promise<InvoiceWithAccountRow[]> {
    return db
      .selectFrom("invoices")
      .leftJoin("accounts", (join) =>
        join
          .onRef("accounts.id", "=", "invoices.account_id")
          .onRef("accounts.tenant_id", "=", "invoices.tenant_id")
      )
      .leftJoin("contacts", (join) =>
        join
          .onRef("contacts.id", "=", "invoices.contact_id")
          .onRef("contacts.tenant_id", "=", "invoices.tenant_id")
      )
      .selectAll("invoices")
      .select(["accounts.name as account", "contacts.name as contact"])
      .where("invoices.tenant_id", "=", tenantId)
      .orderBy("invoices.issued_at", "desc")
      .orderBy("invoices.created_at", "desc")
      .execute();
  }

  async listPayments(tenantId: string): Promise<PaymentRow[]> {
    return db
      .selectFrom("payments")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .orderBy("at", "desc")
      .orderBy("created_at", "desc")
      .execute();
  }

  async findInvoiceById(id: string, tenantId: string): Promise<InvoiceRow | undefined> {
    return db
      .selectFrom("invoices")
      .selectAll()
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  // Highest numeric suffix among INV-<n> numbers, null when none exist.
  async maxInvoiceNumberSuffix(tenantId: string): Promise<number | null> {
    const row = await db
      .selectFrom("invoices")
      .select(
        sql<string | null>`max(substring(number from '^INV-([0-9]+)$')::bigint)`.as("max_suffix")
      )
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return row?.max_suffix == null ? null : Number(row.max_suffix);
  }

  async createInvoice(data: CreateInvoiceData, trx?: Transaction<DB>): Promise<InvoiceRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("invoices")
      .values({
        id: ulid(),
        tenant_id: data.tenant_id,
        number: data.number,
        deal_id: data.deal_id ?? null,
        account_id: data.account_id ?? null,
        contact_id: data.contact_id ?? null,
        amount: data.amount,
        tax: data.tax,
        status: "SENT",
        gateway: data.gateway ?? "Razorpay",
        issued_at: now,
        due_at: data.due_at ?? null,
        details:
          data.details !== undefined
            ? typeof data.details === "string"
              ? data.details
              : JSON.stringify(data.details)
            : "{}",
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateInvoiceStatus(
    id: string,
    tenantId: string,
    patch: { status: invoice_status; paid_at?: Date | null },
    trx?: Transaction<DB>
  ): Promise<InvoiceRow | undefined> {
    return (trx || db)
      .updateTable("invoices")
      .set({
        status: patch.status,
        ...(patch.paid_at !== undefined ? { paid_at: patch.paid_at } : {}),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  // Edits an invoice's mutable fields. Only provided keys are changed; passing
  // null for a link (deal/account/contact) clears it.
  async updateInvoice(
    id: string,
    tenantId: string,
    patch: UpdateInvoiceData
  ): Promise<InvoiceRow | undefined> {
    return db
      .updateTable("invoices")
      .set({
        ...(patch.amount !== undefined ? { amount: patch.amount } : {}),
        ...(patch.tax !== undefined ? { tax: patch.tax } : {}),
        ...(patch.due_at !== undefined ? { due_at: patch.due_at } : {}),
        ...(patch.gateway !== undefined ? { gateway: patch.gateway } : {}),
        ...(patch.deal_id !== undefined ? { deal_id: patch.deal_id } : {}),
        ...(patch.account_id !== undefined ? { account_id: patch.account_id } : {}),
        ...(patch.contact_id !== undefined ? { contact_id: patch.contact_id } : {}),
        ...(patch.details !== undefined
          ? {
              details:
                typeof patch.details === "string"
                  ? patch.details
                  : JSON.stringify(patch.details),
            }
          : {}),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returningAll()
      .executeTakeFirst();
  }

  // True when the invoice has any captured (SUCCESS) payment, used to block
  // deletion of an invoice that has really been collected.
  async hasSuccessfulPayment(invoiceId: string, tenantId: string): Promise<boolean> {
    const row = await db
      .selectFrom("payments")
      .select("id")
      .where("invoice_id", "=", invoiceId)
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "SUCCESS")
      .executeTakeFirst();
    return !!row;
  }

  async deleteInvoice(id: string, tenantId: string, trx?: Transaction<DB>): Promise<boolean> {
    const row = await (trx || db)
      .deleteFrom("invoices")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .returning("id")
      .executeTakeFirst();
    return !!row;
  }

  async deletePaymentsForInvoice(
    invoiceId: string,
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<void> {
    await (trx || db)
      .deleteFrom("payments")
      .where("invoice_id", "=", invoiceId)
      .where("tenant_id", "=", tenantId)
      .execute();
  }

  async createPayment(data: CreatePaymentData, trx?: Transaction<DB>): Promise<PaymentRow> {
    const now = new Date();
    return (trx || db)
      .insertInto("payments")
      .values({
        id: data.id ?? ulid(),
        tenant_id: data.tenant_id,
        invoice_id: data.invoice_id,
        amount: data.amount,
        status: data.status,
        gateway: data.gateway ?? null,
        reference: data.reference,
        pay_url: data.pay_url ?? null,
        gateway_payment_id: data.gateway_payment_id ?? null,
        at: now,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  // ---- Razorpay online collection ----

  // PENDING gateway payment links/sessions to poll for capture, across tenants.
  async pendingGatewayPayments(
    limit = 100
  ): Promise<
    Array<{ id: string; tenant_id: string; invoice_id: string; reference: string; gateway: string }>
  > {
    const rows = await db
      .selectFrom("payments")
      .select(["id", "tenant_id", "invoice_id", "reference", "gateway"])
      .where("status", "=", "PENDING")
      .where("gateway", "in", ["Razorpay", "Stripe"])
      .where("reference", "is not", null)
      .where("amount", ">", 0)
      .orderBy("created_at", "asc")
      .limit(limit)
      .execute();
    return rows.filter(
      (
        r
      ): r is {
        id: string;
        tenant_id: string;
        invoice_id: string;
        reference: string;
        gateway: string;
      } => !!r.reference && !!r.gateway
    );
  }

  async updatePaymentStatus(
    id: string,
    patch: { status: payment_status; gateway_payment_id?: string | null },
    trx?: Transaction<DB>
  ): Promise<void> {
    await (trx || db)
      .updateTable("payments")
      .set({
        status: patch.status,
        ...(patch.gateway_payment_id !== undefined
          ? { gateway_payment_id: patch.gateway_payment_id }
          : {}),
        updated_at: new Date(),
      })
      .where("id", "=", id)
      .execute();
  }

  // The most recent successful gateway payment for an invoice (for refunds).
  async gatewayPaymentForInvoice(
    invoiceId: string,
    tenantId: string
  ): Promise<PaymentRow | undefined> {
    return db
      .selectFrom("payments")
      .selectAll()
      .where("invoice_id", "=", invoiceId)
      .where("tenant_id", "=", tenantId)
      .where("status", "=", "SUCCESS")
      .where("gateway_payment_id", "is not", null)
      .orderBy("at", "desc")
      .executeTakeFirst();
  }

  // Recipient (name/email/phone) for the payment-link customer, from the
  // invoice's linked contact.
  async invoiceContact(
    contactId: string | null,
    tenantId: string
  ): Promise<{ name: string; email: string | null; phone: string | null } | undefined> {
    if (!contactId) return undefined;
    return db
      .selectFrom("contacts")
      .select(["name", "email", "phone"])
      .where("id", "=", contactId)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async dealExists(id: string, tenantId: string): Promise<boolean> {
    const row = await db
      .selectFrom("deals")
      .select("id")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return !!row;
  }

  async accountExists(id: string, tenantId: string): Promise<boolean> {
    const row = await db
      .selectFrom("accounts")
      .select("id")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return !!row;
  }

  async contactExists(id: string, tenantId: string): Promise<boolean> {
    const row = await db
      .selectFrom("contacts")
      .select("id")
      .where("id", "=", id)
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
    return !!row;
  }
}

export default new FinanceRepository();
