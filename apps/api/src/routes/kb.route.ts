import { Router } from "express";
import {
  createArticle,
  getArticle,
  listArticles,
  searchArticles,
} from "../controllers/kb.controller";
import { asyncHandler } from "../utils/asynchandler";

const router = Router();

// Static routes BEFORE /:id (avoids shadowing).
router.get("/", asyncHandler(listArticles));
router.post("/search", asyncHandler(searchArticles));
router.post("/", asyncHandler(createArticle));

router.get("/:id", asyncHandler(getArticle));

export default router;
