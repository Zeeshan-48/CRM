import { Selectable, Transaction, sql } from "kysely";
import { ulid } from "ulid";
import { db } from "../db/connection";
import type { DB, tenant_billing_profiles } from "../db/types";

export type TenantBillingProfileRow = Selectable<tenant_billing_profiles>;

export interface UpsertTenantBillingProfileInput {
  legal_name: string;
  brand_name?: string | null;
  gstin?: string | null;
  cin?: string | null;
  pan?: string | null;
  is_gst_registered?: boolean;
  address: string;
  city: string;
  state: string;
  state_code?: string;
  pincode: string;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  bank_name: string;
  account_name: string;
  account_number: string;
  ifsc: string;
  upi_id?: string | null;
  invoice_prefix?: string;
  next_sequence?: number;
  signatory_name: string;
  signatory_designation?: string;
  signature_url?: string | null;
  logo_url?: string | null;
  jurisdiction_city?: string | null;
  notes?: string | null;
  is_verified?: boolean;
}

class TenantBillingProfileRepository {
  async findByTenantId(
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<TenantBillingProfileRow | undefined> {
    return (trx || db)
      .selectFrom("tenant_billing_profiles")
      .selectAll()
      .where("tenant_id", "=", tenantId)
      .executeTakeFirst();
  }

  async upsert(
    tenantId: string,
    data: UpsertTenantBillingProfileInput,
    trx?: Transaction<DB>
  ): Promise<TenantBillingProfileRow> {
    const existing = await this.findByTenantId(tenantId, trx);
    const now = new Date();

    if (existing) {
      const verifiedAt =
        data.is_verified === true
          ? existing.is_verified
            ? existing.verified_at
            : now
          : data.is_verified === false
          ? null
          : existing.verified_at;

      const updated = await (trx || db)
        .updateTable("tenant_billing_profiles")
        .set({
          legal_name: data.legal_name,
          brand_name: data.brand_name !== undefined ? data.brand_name : existing.brand_name,
          gstin: data.gstin !== undefined ? data.gstin : existing.gstin,
          cin: data.cin !== undefined ? data.cin : existing.cin,
          pan: data.pan !== undefined ? data.pan : existing.pan,
          is_gst_registered:
            data.is_gst_registered !== undefined
              ? data.is_gst_registered
              : existing.is_gst_registered,
          address: data.address,
          city: data.city,
          state: data.state,
          state_code: data.state_code || existing.state_code,
          pincode: data.pincode,
          phone: data.phone !== undefined ? data.phone : existing.phone,
          email: data.email !== undefined ? data.email : existing.email,
          website: data.website !== undefined ? data.website : existing.website,
          bank_name: data.bank_name,
          account_name: data.account_name,
          account_number: data.account_number,
          ifsc: data.ifsc,
          upi_id: data.upi_id !== undefined ? data.upi_id : existing.upi_id,
          invoice_prefix: data.invoice_prefix || existing.invoice_prefix,
          next_sequence:
            data.next_sequence !== undefined ? data.next_sequence : existing.next_sequence,
          signatory_name: data.signatory_name,
          signatory_designation:
            data.signatory_designation || existing.signatory_designation,
          signature_url:
            data.signature_url !== undefined ? data.signature_url : existing.signature_url,
          logo_url: data.logo_url !== undefined ? data.logo_url : existing.logo_url,
          jurisdiction_city:
            data.jurisdiction_city !== undefined
              ? data.jurisdiction_city
              : existing.jurisdiction_city,
          notes: data.notes !== undefined ? data.notes : existing.notes,
          is_verified:
            data.is_verified !== undefined ? data.is_verified : existing.is_verified,
          verified_at: verifiedAt,
          updated_at: now,
        })
        .where("tenant_id", "=", tenantId)
        .returningAll()
        .executeTakeFirstOrThrow();

      return updated;
    }

    const created = await (trx || db)
      .insertInto("tenant_billing_profiles")
      .values({
        id: ulid(),
        tenant_id: tenantId,
        legal_name: data.legal_name,
        brand_name: data.brand_name || null,
        gstin: data.gstin || null,
        cin: data.cin || null,
        pan: data.pan || null,
        is_gst_registered: data.is_gst_registered ?? true,
        address: data.address,
        city: data.city,
        state: data.state,
        state_code: data.state_code || "20",
        pincode: data.pincode,
        phone: data.phone || null,
        email: data.email || null,
        website: data.website || null,
        bank_name: data.bank_name,
        account_name: data.account_name,
        account_number: data.account_number,
        ifsc: data.ifsc,
        upi_id: data.upi_id || null,
        invoice_prefix: data.invoice_prefix || "INV-",
        next_sequence: data.next_sequence || 1001,
        signatory_name: data.signatory_name,
        signatory_designation: data.signatory_designation || "Authorized Signatory",
        signature_url: data.signature_url || null,
        logo_url: data.logo_url || null,
        jurisdiction_city: data.jurisdiction_city || data.city,
        notes: data.notes || null,
        is_verified: data.is_verified ?? false,
        verified_at: data.is_verified ? now : null,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return created;
  }

  /**
   * Atomically increments next_sequence and returns the formatted invoice number.
   */
  async allocateNextInvoiceNumber(
    tenantId: string,
    trx?: Transaction<DB>
  ): Promise<{ number: string; sequence: number } | null> {
    const runner = trx || db;
    const row = await runner
      .updateTable("tenant_billing_profiles")
      .set({
        next_sequence: sql<number>`next_sequence + 1`,
        updated_at: new Date(),
      })
      .where("tenant_id", "=", tenantId)
      .returning(["invoice_prefix", "next_sequence"])
      .executeTakeFirst();

    if (!row) return null;
    const currentSeq = row.next_sequence - 1;
    const prefix = row.invoice_prefix.endsWith("-")
      ? row.invoice_prefix
      : `${row.invoice_prefix}-`;
    return {
      number: `${prefix}${currentSeq}`,
      sequence: currentSeq,
    };
  }
}

export default new TenantBillingProfileRepository();

