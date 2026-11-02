import { Request, Response } from "express";
import { ForbiddenError } from "../errors";
import productsService from "../services/products.service";
import { HttpSuccessStatus, sendSuccessResponse } from "../utils/response.util";

const ctx = (req: Request) => {
  const user = req.authUser;
  if (!user) throw new ForbiddenError("Tenant context required");
  return { tenantId: user.tenantId, actorId: user.id };
};

const qs = (req: Request, key: string): string | undefined => {
  const value = req.query[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

const qsNum = (req: Request, key: string): number | undefined => {
  const raw = qs(req, key);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

// ---- Catalog ----

export const listProducts = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.list(tenantId, {
      q: qs(req, "q"),
      appId: qs(req, "app_id"),
      category: qs(req, "category"),
      status: qs(req, "status"),
      source: qs(req, "source"),
      currency: qs(req, "currency"),
      limit: qsNum(req, "limit"),
      offset: qsNum(req, "offset"),
    }),
  });
};

export const listProductCategories = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({ res, data: await productsService.categories(tenantId) });
};

export const getProduct = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.get(tenantId, String(req.params.id), qs(req, "currency")),
  });
};

export const createProduct = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.createManual(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Product created",
  });
};

export const updateProduct = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.updateManual(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Product updated",
  });
};

export const setProductPrices = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.setPrices(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Prices updated",
  });
};

export const deleteProduct = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.removeManual(tenantId, actorId, String(req.params.id)),
    message: "Product deleted",
  });
};

// ---- Offers ----

export const listOffers = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.listOffers(tenantId, {
      appId: qs(req, "app_id"),
      productId: qs(req, "product_id"),
    }),
  });
};

export const createOffer = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.createOffer(tenantId, actorId, req.body ?? {}),
    statusCode: HttpSuccessStatus.CREATED,
    message: "Offer created",
  });
};

export const updateOffer = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.updateOffer(tenantId, actorId, String(req.params.id), req.body ?? {}),
    message: "Offer updated",
  });
};

export const deleteOffer = async (req: Request, res: Response) => {
  const { tenantId, actorId } = ctx(req);
  sendSuccessResponse({
    res,
    data: await productsService.removeOffer(tenantId, actorId, String(req.params.id)),
    message: "Offer deleted",
  });
};

export const validateCoupon = async (req: Request, res: Response) => {
  const { tenantId } = ctx(req);
  const body = (req.body ?? {}) as Record<string, unknown>;
  sendSuccessResponse({
    res,
    data: await productsService.validateCoupon(
      tenantId,
      String(body.product_id ?? ""),
      String(body.code ?? ""),
      typeof body.currency === "string" ? body.currency : undefined
    ),
  });
};
