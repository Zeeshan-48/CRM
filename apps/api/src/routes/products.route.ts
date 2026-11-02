import { Router } from "express";
import {
  createOffer,
  createProduct,
  deleteOffer,
  deleteProduct,
  getProduct,
  listOffers,
  listProductCategories,
  listProducts,
  setProductPrices,
  updateOffer,
  updateProduct,
  validateCoupon,
} from "../controllers/products.controller";
import { requireCapability } from "../middlewares/module.middleware";
import { validateBody } from "../middlewares/validate.middleware";
import { asyncHandler } from "../utils/asynchandler";
import {
  createOfferSchema,
  createProductSchema,
  setPricesSchema,
  updateOfferSchema,
  updateProductSchema,
  validateCouponSchema,
} from "../validators/products.schema";

// The product catalog an agent pitches from. Reads are open to everyone holding
// the `products` module (that is the point: agents need the catalog). Writes
// only ever touch CRM-native products and require `settings`, because a synced
// catalog is owned by the external system and the service refuses to edit it.
const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listProducts));
router.get("/categories", asyncHandler(listProductCategories));

router.get("/offers", asyncHandler(listOffers));
router.post(
  "/offers",
  asyncHandler(requireCapability("settings")),
  validateBody(createOfferSchema),
  asyncHandler(createOffer)
);
router.patch(
  "/offers/:id",
  asyncHandler(requireCapability("settings")),
  validateBody(updateOfferSchema),
  asyncHandler(updateOffer)
);
router.delete("/offers/:id", asyncHandler(requireCapability("settings")), asyncHandler(deleteOffer));

// Agents validate a coupon a prospect quotes them, so this is NOT settings-gated.
router.post("/validate-coupon", validateBody(validateCouponSchema), asyncHandler(validateCoupon));

router.post(
  "/",
  asyncHandler(requireCapability("settings")),
  validateBody(createProductSchema),
  asyncHandler(createProduct)
);

router.get("/:id", asyncHandler(getProduct));

router.patch(
  "/:id",
  asyncHandler(requireCapability("settings")),
  validateBody(updateProductSchema),
  asyncHandler(updateProduct)
);
router.put(
  "/:id/prices",
  asyncHandler(requireCapability("settings")),
  validateBody(setPricesSchema),
  asyncHandler(setProductPrices)
);
router.delete("/:id", asyncHandler(requireCapability("settings")), asyncHandler(deleteProduct));

export default router;
