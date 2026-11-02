import { Router } from "express";
import { globalSearch } from "../controllers/search.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

router.get("/", asyncHandler(globalSearch));

export default router;
