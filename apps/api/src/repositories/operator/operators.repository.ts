import { Selectable } from "kysely";
import { ulid } from "ulid";
import { db } from "../../db/connection";
import type { operator_role, user_status } from "../../db/enums";
import type { operator_users } from "../../db/types";

export type OperatorRow = Selectable<operator_users>;
export type PublicOperatorRow = Omit<OperatorRow, "password_hash">;

const PUBLIC_COLUMNS = [
  "id",
  "email",
  "name",
  "role",
  "status",
  "last_login_at",
  "created_at",
  "updated_at",
] as const;

class OperatorsRepository {
  async list(): Promise<PublicOperatorRow[]> {
    return db
      .selectFrom("operator_users")
      .select(PUBLIC_COLUMNS)
      .orderBy("created_at", "asc")
      .execute();
  }

  async findById(id: string): Promise<OperatorRow | undefined> {
    return db.selectFrom("operator_users").selectAll().where("id", "=", id).executeTakeFirst();
  }

  async findByEmail(email: string): Promise<OperatorRow | undefined> {
    return db
      .selectFrom("operator_users")
      .selectAll()
      .where("email", "=", email)
      .executeTakeFirst();
  }

  async create(data: {
    name: string;
    email: string;
    role: operator_role;
    passwordHash: string;
  }): Promise<PublicOperatorRow> {
    const t = new Date();
    return db
      .insertInto("operator_users")
      .values({
        id: ulid(),
        name: data.name,
        email: data.email,
        password_hash: data.passwordHash,
        role: data.role,
        status: "ACTIVE",
        created_at: t,
        updated_at: t,
      })
      .returning(PUBLIC_COLUMNS)
      .executeTakeFirstOrThrow();
  }

  async update(
    id: string,
    data: Partial<{ name: string; role: operator_role; status: user_status }>
  ): Promise<PublicOperatorRow | undefined> {
    const patch: Record<string, unknown> = { updated_at: new Date() };
    if (data.name !== undefined) patch.name = data.name;
    if (data.role !== undefined) patch.role = data.role;
    if (data.status !== undefined) patch.status = data.status;
    return db
      .updateTable("operator_users")
      .set(patch)
      .where("id", "=", id)
      .returning(PUBLIC_COLUMNS)
      .executeTakeFirst();
  }

  async updatePassword(id: string, passwordHash: string): Promise<void> {
    await db
      .updateTable("operator_users")
      .set({ password_hash: passwordHash, updated_at: new Date() })
      .where("id", "=", id)
      .execute();
  }

  touchLastLogin(id: string): void {
    db.updateTable("operator_users")
      .set({ last_login_at: new Date(), updated_at: new Date() })
      .where("id", "=", id)
      .execute()
      .catch(() => undefined);
  }
}

export default new OperatorsRepository();
