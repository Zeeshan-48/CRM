import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { plans } from "../../db/types";

export type PlanRow = Selectable<plans>;

class PlansRepository {
  async list(): Promise<PlanRow[]> {
    return db.selectFrom("plans").selectAll().orderBy("sort_order", "asc").execute();
  }

  async findById(id: string): Promise<PlanRow | undefined> {
    return db.selectFrom("plans").selectAll().where("id", "=", id).executeTakeFirst();
  }

  async findByKey(key: string): Promise<PlanRow | undefined> {
    return db.selectFrom("plans").selectAll().where("key", "=", key).executeTakeFirst();
  }

  async create(data: {
    key: string;
    name: string;
    description: string | null;
    price_monthly: number;
    modules: string[];
    limits: Record<string, number>;
  }): Promise<PlanRow> {
    const t = new Date();
    return db
      .insertInto("plans")
      .values({
        id: ulid(),
        key: data.key,
        name: data.name,
        description: data.description,
        price_monthly: data.price_monthly,
        currency: "INR",
        modules: JSON.stringify(data.modules),
        limits: JSON.stringify(data.limits),
        is_active: true,
        sort_order: 0,
        created_at: t,
        updated_at: t,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    data: Partial<{
      name: string;
      description: string | null;
      price_monthly: number;
      modules: string[];
      limits: Record<string, number>;
      is_active: boolean;
      sort_order: number;
    }>
  ): Promise<PlanRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.description !== undefined) patch.description = data.description;
    if (data.price_monthly !== undefined) patch.price_monthly = data.price_monthly;
    if (data.modules !== undefined) patch.modules = JSON.stringify(data.modules);
    if (data.limits !== undefined) patch.limits = JSON.stringify(data.limits);
    if (data.is_active !== undefined) patch.is_active = data.is_active;
    if (data.sort_order !== undefined) patch.sort_order = data.sort_order;
    return db
      .updateTable("plans")
      .set(patch)
      .where("id", "=", id)
      .returningAll()
      .executeTakeFirst();
  }
}

export default new PlansRepository();
