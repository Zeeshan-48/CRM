import { ulid } from "ulid";
import { db } from "../db/connection";
import { BadRequestError, NotFoundError } from "../errors";
import financeRepository, {
  InvoiceRow,
  PaymentRow,
} from "../repositories/finance.repository";
import logger from "../utils/logger";
import engineService from "./engine.service";
import paymentGatewayService from "./payment-gateway.service";

export const PAYMENT_GATEWAYS = [
  { id: "razorpay", name: "Razorpay", live: true },
  { id: "stripe", name: "Stripe", live: true },
] as const;

const DEFAULT_TAX_RATE = 0.18;

const invoiceTotal = (invoice: InvoiceRow): number => invoice.amount + (invoice.tax || 0);

class FinanceService {
  gateways() {
    return PAYMENT_GATEWAYS;
  }

  async summary(tenantId: string) {
    return financeRepository.summary(tenantId);
  }

  async invoices(tenantId: string) {
    const rows = await financeRepository.listInvoices(tenantId);
    return rows.map((row) => ({ ...row, total: invoiceTotal(row) }));
  }

  async payments(tenantId: string): Promise<PaymentRow[]> {
    return financeRepository.listPayments(tenantId);
  }

  async createInvoice(
    tenantId: string,
    actorId: string,
    body: {
      amount?: unknown;
      tax?: unknown;
      dealId?: string;
      accountId?: string;
      contactId?: string;
      dueAt?: string;
      gateway?: string;
    }
  ) {
    if (body.amount === undefined || body.amount === null) {
      throw new BadRequestError("amount required");
    }
    const amount = Number(body.amount);
    if (!Number.isInteger(amount) || amount <= 0) {
      throw new BadRequestError("amount must be a positive integer (rupees)");
    }

    let tax = Math.round(amount * DEFAULT_TAX_RATE);
    if (body.tax !== undefined && body.tax !== null) {
      const provided = Number(body.tax);
      if (!Number.isInteger(provided) || provided < 0) {
        throw new BadRequestError("tax must be a non-negative integer (rupees)");
      }
      tax = provided;
    }

    let dueAt: Date | null = null;
    if (body.dueAt) {
      dueAt = new Date(body.dueAt);
      if (Number.isNaN(dueAt.getTime())) throw new BadRequestError("dueAt must be a valid date");
    }

    if (body.dealId && !(await financeRepository.dealExists(body.dealId, tenantId))) {
      throw new NotFoundError("Deal not found");
    }
    if (body.accountId && !(await financeRepository.accountExists(body.accountId, tenantId))) {
      throw new NotFoundError("Account not found");
    }
    if (body.contactId && !(await financeRepository.contactExists(body.contactId, tenantId))) {
      throw new NotFoundError("Contact not found");
    }

    const maxSuffix = await financeRepository.maxInvoiceNumberSuffix(tenantId);
    const number = `INV-${maxSuffix != null ? maxSuffix + 1 : Date.now()}`;

    const invoice = await financeRepository.createInvoice({
      tenant_id: tenantId,
      number,
      deal_id: body.dealId ?? null,
      account_id: body.accountId ?? null,
      contact_id: body.contactId ?? null,
      amount,
      tax,
      gateway: body.gateway ?? "Razorpay",
      due_at: dueAt,
    });

    engineService.audit(tenantId, actorId, "invoice.created", "invoice", invoice.id, {
      number: invoice.number,
      amount: invoice.amount,
    });
    return { ...invoice, total: invoiceTotal(invoice) };
  }

  // Edits an unpaid invoice. Paid/refunded invoices are locked (their amounts
  // back real payment/refund records), so only SENT/OVERDUE invoices are editable.
  async updateInvoice(
    tenantId: string,
    actorId: string,
    invoiceId: string,
    body: {
      amount?: unknown;
      tax?: unknown;
      dealId?: string | null;
      accountId?: string | null;
      contactId?: string | null;
      dueAt?: string | null;
      gateway?: string;
    }
  ) {
    const invoice = await financeRepository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.status !== "SENT" && invoice.status !== "OVERDUE") {
      throw new BadRequestError("Only unpaid (SENT or OVERDUE) invoices can be edited");
    }

    const patch: {
      amount?: number;
      tax?: number;
      due_at?: Date | null;
      gateway?: string | null;
      deal_id?: string | null;
      account_id?: string | null;
      contact_id?: string | null;
    } = {};

    if (body.amount !== undefined && body.amount !== null) {
      const amount = Number(body.amount);
      if (!Number.isInteger(amount) || amount <= 0) {
        throw new BadRequestError("amount must be a positive integer (rupees)");
      }
      patch.amount = amount;
    }
    if (body.tax !== undefined && body.tax !== null) {
      const tax = Number(body.tax);
      if (!Number.isInteger(tax) || tax < 0) {
        throw new BadRequestError("tax must be a non-negative integer (rupees)");
      }
      patch.tax = tax;
    }
    if (body.dueAt !== undefined) {
      if (body.dueAt === null || body.dueAt === "") {
        patch.due_at = null;
      } else {
        const dueAt = new Date(body.dueAt);
        if (Number.isNaN(dueAt.getTime())) throw new BadRequestError("dueAt must be a valid date");
        patch.due_at = dueAt;
      }
    }
    if (body.gateway !== undefined) patch.gateway = body.gateway;

    if (body.dealId !== undefined) {
      if (body.dealId && !(await financeRepository.dealExists(body.dealId, tenantId))) {
        throw new NotFoundError("Deal not found");
      }
      patch.deal_id = body.dealId ?? null;
    }
    if (body.accountId !== undefined) {
      if (body.accountId && !(await financeRepository.accountExists(body.accountId, tenantId))) {
        throw new NotFoundError("Account not found");
      }
      patch.account_id = body.accountId ?? null;
    }
    if (body.contactId !== undefined) {
      if (body.contactId && !(await financeRepository.contactExists(body.contactId, tenantId))) {
        throw new NotFoundError("Contact not found");
      }
      patch.contact_id = body.contactId ?? null;
    }

    const updated = await financeRepository.updateInvoice(invoiceId, tenantId, patch);
    if (!updated) throw new NotFoundError("Invoice not found");

    engineService.audit(tenantId, actorId, "invoice.updated", "invoice", invoiceId, {
      number: updated.number,
      amount: updated.amount,
    });
    return { ...updated, total: invoiceTotal(updated) };
  }

  // Deletes an invoice and any pending payment-link records. Paid/refunded
  // invoices (and any invoice with a captured payment) are never deletable, so
  // real revenue/refund history can't be erased.
  async removeInvoice(tenantId: string, actorId: string, invoiceId: string) {
    const invoice = await financeRepository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.status === "PAID" || invoice.status === "REFUNDED") {
      throw new BadRequestError("Paid or refunded invoices cannot be deleted");
    }
    if (await financeRepository.hasSuccessfulPayment(invoiceId, tenantId)) {
      throw new BadRequestError("This invoice has a captured payment and cannot be deleted");
    }

    await db.transaction().execute(async (trx) => {
      await financeRepository.deletePaymentsForInvoice(invoiceId, tenantId, trx);
      const deleted = await financeRepository.deleteInvoice(invoiceId, tenantId, trx);
      if (!deleted) throw new NotFoundError("Invoice not found");
    });

    engineService.audit(tenantId, actorId, "invoice.deleted", "invoice", invoiceId, {
      number: invoice.number,
    });
    return { ok: true };
  }

  async payInvoice(tenantId: string, actorId: string, invoiceId: string) {
    const invoice = await financeRepository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) throw new NotFoundError("Invoice not found");

    const result = await db.transaction().execute(async (trx) => {
      const updated = await financeRepository.updateInvoiceStatus(
        invoiceId,
        tenantId,
        { status: "PAID", paid_at: new Date() },
        trx
      );
      if (!updated) throw new NotFoundError("Invoice not found");

      const payment = await financeRepository.createPayment(
        {
          tenant_id: tenantId,
          invoice_id: invoice.id,
          amount: invoiceTotal(invoice),
          status: "SUCCESS",
          gateway: invoice.gateway,
          reference: `pay_${ulid()}`,
        },
        trx
      );
      return { invoice: updated, payment };
    });

    engineService.audit(tenantId, actorId, "invoice.paid", "invoice", invoice.id, {
      number: invoice.number,
      amount: result.payment.amount,
    });
    return result;
  }

  async refundInvoice(
    tenantId: string,
    actorId: string,
    invoiceId: string,
    opts: { manual?: boolean } = {}
  ) {
    const invoice = await financeRepository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.status !== "PAID") {
      throw new BadRequestError("Only PAID invoices can be refunded");
    }

    // If the invoice was collected online, issue a real refund against the
    // captured payment via the gateway that took it. `manual` skips the gateway
    // and just records the reversal locally (offline reconciliation), used as a
    // fallback when the gateway rejects the refund (e.g. an unactivated test
    // account). Manual/offline payments never had a real charge, so they flip
    // directly.
    let reference = `rfnd_${ulid()}`;
    const gatewayPayment = await financeRepository.gatewayPaymentForInvoice(invoiceId, tenantId);
    const gwName = gatewayPayment?.gateway;
    if (
      !opts.manual &&
      gatewayPayment?.gateway_payment_id &&
      gwName &&
      paymentGatewayService.isName(gwName)
    ) {
      const resolved = await paymentGatewayService.resolveByName(tenantId, gwName);
      if (resolved.mode !== "none" || paymentGatewayService.isSimulated(gwName)) {
        const refund = await paymentGatewayService.refund(
          gwName,
          resolved.creds,
          gatewayPayment.gateway_payment_id,
          invoiceTotal(invoice) * 100
        );
        if (refund.error) throw new BadRequestError(`${gwName} refund failed: ${refund.error}`);
        if (refund.id) reference = refund.id;
      }
    }

    const result = await db.transaction().execute(async (trx) => {
      const updated = await financeRepository.updateInvoiceStatus(
        invoiceId,
        tenantId,
        { status: "REFUNDED" },
        trx
      );
      if (!updated) throw new NotFoundError("Invoice not found");

      const payment = await financeRepository.createPayment(
        {
          tenant_id: tenantId,
          invoice_id: invoice.id,
          amount: -invoiceTotal(invoice),
          status: "REFUNDED",
          gateway: invoice.gateway,
          reference,
        },
        trx
      );
      return { invoice: updated, payment };
    });

    engineService.audit(tenantId, actorId, "invoice.refunded", "invoice", invoice.id, {
      number: invoice.number,
      amount: result.payment.amount,
    });
    return result;
  }

  // Online collection: generate a real Razorpay payment link and record a
  // PENDING payment. The poll job flips the invoice to PAID once captured.
  async createPaymentLink(tenantId: string, actorId: string, invoiceId: string) {
    const invoice = await financeRepository.findInvoiceById(invoiceId, tenantId);
    if (!invoice) throw new NotFoundError("Invoice not found");
    if (invoice.status !== "SENT" && invoice.status !== "OVERDUE") {
      throw new BadRequestError("Only SENT or OVERDUE invoices can be collected online");
    }

    const resolved = await paymentGatewayService.resolveForNewLink(tenantId);
    if (resolved.mode === "none") {
      throw new BadRequestError(
        "Connect a payment gateway (Razorpay or Stripe) in Finance settings to collect online."
      );
    }

    const total = invoiceTotal(invoice);
    const paymentId = ulid();
    const contact = await financeRepository.invoiceContact(invoice.contact_id, tenantId);

    const link = await paymentGatewayService.createLink(resolved.name, resolved.creds, {
      amountPaise: total * 100,
      description: `Invoice ${invoice.number}`,
      referenceId: paymentId,
      customer: contact
        ? { name: contact.name, email: contact.email, contact: contact.phone }
        : undefined,
    });
    if (link.error) throw new BadRequestError(`${resolved.name}: ${link.error}`);

    const payment = await financeRepository.createPayment({
      id: paymentId,
      tenant_id: tenantId,
      invoice_id: invoice.id,
      amount: total,
      status: "PENDING",
      gateway: resolved.name,
      reference: link.id,
      pay_url: link.shortUrl,
    });

    engineService.audit(tenantId, actorId, "invoice.payment_link_created", "invoice", invoice.id, {
      number: invoice.number,
      amount: total,
      gateway: resolved.name,
      simulated: link.simulated,
    });
    return { payment, pay_url: link.shortUrl, simulated: link.simulated, gateway: resolved.name };
  }

  // Polls PENDING gateway payment links/sessions and confirms paid ones
  // (invoice -> PAID, payment -> SUCCESS). Failed/cancelled links mark the
  // payment FAILED. Each payment follows the gateway that created it. Called by
  // the payments poll job; safe to run repeatedly.
  async confirmPendingPayments(limit = 100): Promise<{ confirmed: number }> {
    const pending = await financeRepository.pendingGatewayPayments(limit);
    // Cache resolved creds per (tenant, gateway).
    const credsCache = new Map<string, { mode: string; creds: unknown }>();
    let confirmed = 0;

    for (const p of pending) {
      try {
        if (!paymentGatewayService.isName(p.gateway)) continue;
        const gwName = p.gateway;
        const cacheKey = `${p.tenant_id}:${gwName}`;
        let resolved = credsCache.get(cacheKey);
        if (!resolved) {
          resolved = await paymentGatewayService.resolveByName(p.tenant_id, gwName);
          credsCache.set(cacheKey, resolved);
        }
        if (resolved.mode === "none") continue;

        const status = await paymentGatewayService.fetchStatus(
          gwName,
          resolved.creds as never,
          p.reference
        );
        if (!status) continue; // simulated link or transient failure

        if (status.status === "paid") {
          await db.transaction().execute(async (trx) => {
            await financeRepository.updatePaymentStatus(
              p.id,
              { status: "SUCCESS", gateway_payment_id: status.paymentId },
              trx
            );
            await financeRepository.updateInvoiceStatus(
              p.invoice_id,
              p.tenant_id,
              { status: "PAID", paid_at: new Date() },
              trx
            );
          });
          confirmed++;
        } else if (status.status === "failed") {
          await financeRepository.updatePaymentStatus(p.id, { status: "FAILED" });
        }
      } catch (err) {
        logger.warn(`gateway confirm payment ${p.id}: ${String(err)}`);
      }
    }
    return { confirmed };
  }
}

export default new FinanceService();
