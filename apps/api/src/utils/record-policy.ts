import { isElevatedRole } from "../constants/modules.const";
import { ForbiddenError } from "../errors";

// Record-level WRITE policy for the open-visibility model.
//
// Reading/editing stays collaborative (everyone with the module can view and
// edit). But destructive and ownership-changing actions are guarded so one
// user can't wipe or hijack another's book:
//   - delete a single record  -> you must OWN it, or be a manager/admin.
//   - reassign a record's owner -> you may hand off a record you own, claim an
//     UNASSIGNED one, or (manager/admin) reassign anything. You can't yank a
//     record owned by someone else.
//   - bulk / mass operations   -> manager/admin only.
//
// "Manager/admin" is the elevated-role tier (ELEVATED_ROLES); ownership is
// `owner_id === actor.id`.

export const canManageRecord = (
  actorId: string,
  actorRole: string,
  ownerId: string | null | undefined
): boolean => isElevatedRole(actorRole) || (!!ownerId && ownerId === actorId);

export const assertCanManageRecord = (
  actorId: string,
  actorRole: string,
  ownerId: string | null | undefined,
  verb = "modify",
  noun = "record"
): void => {
  if (!canManageRecord(actorId, actorRole, ownerId)) {
    throw new ForbiddenError(
      `You can only ${verb} ${noun}s you own. Ask a manager to ${verb} someone else's.`
    );
  }
};

// Reassignment is allowed for your own records, unassigned records (claiming
// from the pool), and for managers/admins on anything.
export const assertCanReassign = (
  actorId: string,
  actorRole: string,
  ownerId: string | null | undefined,
  noun = "record"
): void => {
  const allowed = isElevatedRole(actorRole) || !ownerId || ownerId === actorId;
  if (!allowed) {
    throw new ForbiddenError(
      `You can't reassign a ${noun} owned by someone else. Ask a manager.`
    );
  }
};

export const assertCanBulk = (actorRole: string, action = "run bulk actions"): void => {
  if (!isElevatedRole(actorRole)) {
    throw new ForbiddenError(`Only a manager or admin can ${action}.`);
  }
};
