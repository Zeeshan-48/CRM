import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Package, Pencil, Plus, Search, Ticket, Trash2, X } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-provider";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
import { OfferFormDialog } from "@/components/products/OfferFormDialog";
import { ProductCard } from "@/components/products/ProductCard";
import { ProductFormDialog } from "@/components/products/ProductFormDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  deleteOffer,
  deleteProduct,
  listConnectedApps,
  listOffers,
  listProductCategories,
  listProducts,
  validateCoupon,
  type OfferRow,
  type Product,
} from "@/lib/api/products";
import { formatDate } from "@/lib/format";

const ALL = "__all__";

/** Debounces the search box so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

// ---------------------------------------------------------------------------

/**
 * Checks a code a prospect just read out over the phone.
 *
 * One answer for "no such code", "expired" and "wrong product", because to an
 * agent they mean the same thing, and spelling out which would let anyone
 * enumerate the offer list.
 */
function CouponChecker() {
  const [productId, setProductId] = React.useState("");
  const [code, setCode] = React.useState("");
  const [result, setResult] = React.useState<
    { ok: true; label: string; detail: string } | { ok: false; reason: string } | null
  >(null);

  const { data } = useQuery({
    queryKey: ["coupon-check-products"],
    queryFn: () => listProducts({ limit: 100 }),
  });

  const mutation = useMutation({
    mutationFn: () => validateCoupon(productId, code.trim()),
    onSuccess: (check) => {
      setResult(
        check.valid
          ? {
              ok: true,
              label: check.offer.name,
              detail: `${check.offer.discount_display} off, they pay ${check.offer.final_display}`,
            }
          : { ok: false, reason: check.reason }
      );
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const products = data?.items ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 pt-5">
        <div>
          <h3 className="font-semibold">Check a code</h3>
          <p className="text-sm text-muted-foreground">
            A customer quoted a code and you need to know if it still works.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Select value={productId} onValueChange={setProductId}>
            <SelectTrigger className="min-w-[200px] flex-1">
              <SelectValue placeholder="Which product" />
            </SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            value={code}
            onChange={(e) => {
              setCode(e.target.value.toUpperCase());
              setResult(null);
            }}
            placeholder="AUG20"
            className="w-36 font-mono"
            aria-label="Coupon code"
          />

          <Button
            type="button"
            disabled={!productId || !code.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? "Checking..." : "Check"}
          </Button>
        </div>

        {result ? (
          result.ok ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2">
              <Check className="mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  {result.label}
                </p>
                <p className="text-sm text-muted-foreground">{result.detail}</p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2">
              <X className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-700 dark:text-red-300">{result.reason}</p>
            </div>
          )
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------

function CatalogTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [search, setSearch] = React.useState("");
  const [category, setCategory] = React.useState(ALL);
  const [appId, setAppId] = React.useState(ALL);
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<Product | null>(null);
  const debouncedSearch = useDebounced(search);

  const { data: apps } = useQuery({
    queryKey: ["connected-apps"],
    queryFn: listConnectedApps,
  });
  const { data: categories } = useQuery({
    queryKey: ["product-categories"],
    queryFn: listProductCategories,
  });

  const filters = {
    q: debouncedSearch || undefined,
    category: category === ALL ? undefined : category,
    app_id: appId === ALL ? undefined : appId,
  };

  const { data, isLoading } = useQuery({
    queryKey: ["products", filters],
    queryFn: () => listProducts(filters),
    // Keeps the previous page on screen while a filter change loads, so the
    // grid does not collapse to skeletons on every keystroke.
    placeholderData: (previous) => previous,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProduct(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Product deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search products"
            className="pl-9"
            aria-label="Search products"
          />
        </div>

        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            {(categories ?? []).map((c) => (
              <SelectItem key={c} value={c}>
                {c}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={appId} onValueChange={setAppId}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All products" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All connected products</SelectItem>
            {(apps ?? []).map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-64 w-full" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Package}
          title="Nothing in the catalog yet"
          description="Connect a product and publish its catalog, or add one here by hand, and it will appear for your agents to pitch from."
          action={
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              Add a product
            </Button>
          }
        />
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            {data?.total ?? items.length} product{(data?.total ?? 0) === 1 ? "" : "s"}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((product) => (
              <div key={product.id} className="relative">
                <ProductCard product={product} />
                {/* Only CRM-native products are editable here. A synced one is
                    owned by the source system, and an edit would be silently
                    reverted on its next sync. */}
                {product.editable ? (
                  <div className="absolute right-3 top-3 flex gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0"
                      aria-label={`Edit ${product.name}`}
                      onClick={() => {
                        setEditing(product);
                        setFormOpen(true);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="size-7 p-0 text-muted-foreground hover:text-destructive"
                      aria-label={`Delete ${product.name}`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Delete this product?",
                          description: `"${product.name}" will be removed from the catalog. Deals that already include it keep their line items.`,
                          destructive: true,
                          confirmText: "Delete",
                        });
                        if (ok) deleteMutation.mutate(product.id);
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      <ProductFormDialog product={editing} open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function OffersTab() {
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<OfferRow | null>(null);

  const { data, isLoading } = useQuery({ queryKey: ["offers"], queryFn: () => listOffers() });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteOffer(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success("Offer deleted");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const offers = data ?? [];
  const now = Date.now();

  return (
    <div className="space-y-4">
      <CouponChecker />

      {isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : offers.length === 0 ? (
        <EmptyState
          icon={Ticket}
          title="No offers yet"
          description="Offers published by a connected product show up here, and you can create your own. Both appear on every matching product card."
          action={
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              New offer
            </Button>
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {offers.map((offer) => {
            // The window is the truth, not the stored status: an ACTIVE row with
            // a past end date must never look quotable to an agent.
            const ended = offer.ends_at ? new Date(offer.ends_at).getTime() < now : false;
            const notStarted = offer.starts_at
              ? new Date(offer.starts_at).getTime() > now
              : false;
            const exhausted = offer.redemptions_left === 0;
            const live = !ended && !notStarted && !exhausted && offer.status !== "DISABLED";
            // Synced offers belong to the source system and are read-only here.
            const editable = !offer.app_id;

            return (
              <Card key={offer.id}>
                <CardContent className="space-y-2 pt-5">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate font-semibold leading-tight">{offer.name}</h3>
                      <p className="mt-0.5 text-sm text-muted-foreground">
                        {/* Server-formatted: a FLAT discount_value is in minor
                            units, and dividing by 100 here printed
                            "Flat 5000.00 INR off" instead of "₹5,000 off". */}
                        {offer.discount_display ??
                          (offer.discount_type === "PERCENT"
                            ? `${offer.discount_value}% off`
                            : `${offer.discount_value} ${offer.currency ?? ""} off`)}
                      </p>
                    </div>
                    <Badge
                      variant="outline"
                      className={
                        live
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-slate-500/30 bg-slate-500/10 text-slate-600 dark:text-slate-300"
                      }
                    >
                      {live
                        ? "Live"
                        : exhausted
                          ? "Used up"
                          : notStarted
                            ? "Scheduled"
                            : ended
                              ? "Expired"
                              : "Off"}
                    </Badge>
                  </div>

                  {offer.code ? (
                    <code className="inline-block rounded bg-muted px-2 py-1 font-mono text-xs">
                      {offer.code}
                    </code>
                  ) : (
                    <p className="text-xs text-muted-foreground">Automatic, no code needed</p>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    {offer.ends_at ? (
                      <span>Ends {formatDate(offer.ends_at)}</span>
                    ) : (
                      <span>No end date</span>
                    )}
                    {offer.redemptions_left !== null ? (
                      <span>{offer.redemptions_left} left</span>
                    ) : null}
                  </div>

                  {offer.terms ? (
                    <p className="text-xs text-muted-foreground">{offer.terms}</p>
                  ) : null}

                  {editable ? (
                    <div className="flex gap-1 border-t pt-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditing(offer);
                          setFormOpen(true);
                        }}
                      >
                        <Pencil className="size-3.5" />
                        Edit
                      </Button>
                      <Button aria-label="Delete offer"
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-muted-foreground hover:text-destructive"
                        onClick={async () => {
                          const ok = await confirm({
                            title: "Delete this offer?",
                            description: `"${offer.name}" will stop appearing on product cards.`,
                            destructive: true,
                            confirmText: "Delete",
                          });
                          if (ok) deleteMutation.mutate(offer.id);
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <p className="border-t pt-2 text-xs text-muted-foreground">
                      Published by a connected product
                    </p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <OfferFormDialog offer={editing} open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}

// ---------------------------------------------------------------------------

/**
 * The catalog an agent pitches from: what the connected products sell, what it
 * costs right now, and which discounts are live.
 */
export default function ProductsPage() {
  const [tab, setTab] = React.useState("catalog");
  const [productFormOpen, setProductFormOpen] = React.useState(false);
  const [offerFormOpen, setOfferFormOpen] = React.useState(false);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="What your connected products sell, with live pricing and offers. Everything synced stays in step with the source system."
        actions={
          tab === "catalog" ? (
            <Button type="button" onClick={() => setProductFormOpen(true)}>
              <Plus className="size-4" />
              Add product
            </Button>
          ) : (
            <Button type="button" onClick={() => setOfferFormOpen(true)}>
              <Plus className="size-4" />
              New offer
            </Button>
          )
        }
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="catalog">Catalog</TabsTrigger>
          <TabsTrigger value="offers">Offers &amp; coupons</TabsTrigger>
        </TabsList>
        <TabsContent value="catalog" className="mt-4">
          <CatalogTab />
        </TabsContent>
        <TabsContent value="offers" className="mt-4">
          <OffersTab />
        </TabsContent>
      </Tabs>

      {/* Header actions open the same dialogs the tabs use. */}
      <ProductFormDialog product={null} open={productFormOpen} onOpenChange={setProductFormOpen} />
      <OfferFormDialog offer={null} open={offerFormOpen} onOpenChange={setOfferFormOpen} />
    </div>
  );
}
