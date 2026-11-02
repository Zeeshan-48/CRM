import { Router } from "express";
import {
  changeMyPassword,
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  listUsers,
  resetUserPassword,
  rolesCatalogue,
  updateMyProfile,
  updateRole,
  updateUser,
} from "../controllers/users.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(listUsers));
router.get("/roles", asyncHandler(rolesCatalogue));
// Self-service: any authenticated user updates their own profile (callback
// number). Declared before /:id so "me" is not captured as a param.
router.patch("/me", asyncHandler(updateMyProfile));
// Self-service: change own password (verifies the current password).
router.patch("/me/password", asyncHandler(changeMyPassword));
router.post("/", asyncHandler(requireCapability("team")), asyncHandler(createUser));
router.put("/:id", asyncHandler(requireCapability("team")), asyncHandler(updateUser));
// Remove a user (reassigns their owned work first). Policy, no self-delete,
// managers can't remove admins, never the last admin, is enforced in the
// service. Two-segment role routes below never collide with this.
router.delete("/:id", asyncHandler(requireCapability("team")), asyncHandler(deleteUser));
// Admin-only: reset another member's password (generates + emails a new one).
router.post(
  "/:id/reset-password",
  asyncHandler(requireCapability("team")),
  asyncHandler(resetUserPassword)
);
router.post("/roles", asyncHandler(requireCapability("team")), asyncHandler(createRole));
// Edit / delete a custom role (built-in roles are immutable; delete is blocked
// while users still hold the role). Two path segments, so these never collide
// with the single-segment PUT "/:id" above.
router.put("/roles/:key", asyncHandler(requireCapability("team")), asyncHandler(updateRole));
router.delete("/roles/:key", asyncHandler(requireCapability("team")), asyncHandler(deleteRole));

export default router;
