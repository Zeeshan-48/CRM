import { Router } from "express";
import {
  addContract,
  createAccount,
  deleteAccount,
  deleteContract,
  getAccount,
  listAccounts,
  updateAccount,
  updateContract,
} from "../controllers/accounts.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listAccounts));
router.post("/", asyncHandler(createAccount));

router.get("/:id", asyncHandler(getAccount));
router.put("/:id", asyncHandler(updateAccount));
router.delete("/:id", asyncHandler(deleteAccount));
router.post("/:id/contracts", asyncHandler(addContract));
router.put("/:id/contracts/:contractId", asyncHandler(updateContract));
router.delete("/:id/contracts/:contractId", asyncHandler(deleteContract));

export default router;
