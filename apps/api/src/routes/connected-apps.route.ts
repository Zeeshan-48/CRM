import { Router } from "express";
import {
  createApp,
  createAppKey,
  deleteApp,
  getApp,
  listApps,
  invokeAction,
  listAllActions,
  listAppActions,
  listEventDefinitions,
  rotateActionsSecret,
  updateApp,
  updateEventDefinition,
} from "../controllers/connected-apps.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { validateBody } from "../middlewares/validate.middleware";
import { asyncHandler } from "../utils/asynchandler";
import {
  createAppKeySchema,
  createConnectedAppSchema,
  updateConnectedAppSchema,
  updateEventDefinitionSchema,
} from "../validators/connected-apps.schema";

// Connected products: the external systems a workspace has wired up.
// Mounted under the `products` module gate (see routes/index.ts). Reading the
// list is part of the module; CHANGING the wiring is workspace administration,
// so every mutating route additionally requires the `settings` capability.
// That is what lets a sales agent see which products exist without being able
// to repoint an integration or mint a key.
const router = Router();

// Every product action available in this workspace, for a record action menu.
router.get("/actions", asyncHandler(listAllActions));

router.get("/", asyncHandler(listApps));
router.get("/:id", asyncHandler(getApp));

router.post(
  "/",
  asyncHandler(requireCapability("settings")),
  validateBody(createConnectedAppSchema),
  asyncHandler(createApp)
);

router.patch(
  "/:id",
  asyncHandler(requireCapability("settings")),
  validateBody(updateConnectedAppSchema),
  asyncHandler(updateApp)
);

router.delete("/:id", asyncHandler(requireCapability("settings")), asyncHandler(deleteApp));

router.post(
  "/:id/keys",
  asyncHandler(requireCapability("settings")),
  validateBody(createAppKeySchema),
  asyncHandler(createAppKey)
);

router.post(
  "/:id/rotate-actions-secret",
  asyncHandler(requireCapability("settings")),
  asyncHandler(rotateActionsSecret)
);

// ---- Event registry ----
// Reading is part of the module (agents benefit from seeing what a product
// reports). Retuning a weight changes who surfaces in the signals feed for the
// whole workspace, so it is administration.
router.get("/:id/events", asyncHandler(listEventDefinitions));
router.patch(
  "/:id/events/:definitionId",
  asyncHandler(requireCapability("settings")),
  validateBody(updateEventDefinitionSchema),
  asyncHandler(updateEventDefinition)
);

// ---- Product actions (CRM -> product) ----
// Firing an action mutates a real customer's account in another system, so it
// requires the same capability as changing the wiring, not just module access.
router.get("/:id/actions", asyncHandler(listAppActions));
router.post(
  "/:id/actions/:actionKey",
  asyncHandler(requireCapability("settings")),
  asyncHandler(invokeAction)
);

export default router;
