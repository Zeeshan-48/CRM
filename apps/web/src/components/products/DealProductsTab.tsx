import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Package, Plus, Search, Ticket, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  addDealLineItem,
  listDealLineItems,
  listProducts,
  removeDealLineItem,
  updateDealLineItem,
  type Product,
} from "@/lib/api/products";

/** Debounces the catalog search so typing does not fire a request per keystroke. */
function useDebounced<T>(value: T, delay = 300): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function AddProductDialog({
  dealId,
  open,
  onOpenChange,
}: {
  dealId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState<Product | null>(null);
  const [quantity, setQuantity] = React.useState("1");
  const [offerId, setOfferId] = React.useState<string | null>(null);
  const debounced = useDebounced(search);

  const reset = () => {
    setSearch("");
    setSelected(null);
    setQuantity("1");
    setOfferId(null);
  };

  const { data, isLoading } = useQuery({
    queryKey: ["deal-product-picker", debounced],
    queryFn: () => listProducts({ q: debounced || undefined, limit: 20 }),
    enabled: open,
    placeholderData: (previous) => previous,
  });

  const mutation = useMutation({
    mutationFn: () =>
      addDealLineItem(dealId, {
        product_id: selected?.id,
        quantity: Math.max(1, Number(quantity) || 1),
        offer_id: offerId ?? undefined,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["deal-line-items", dealId] });
      // The deal's value is DERIVED from its line items, so the deal itself and
      // the board that shows its total are both now stale.
      void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
      void queryClient.invalidateQueries({ queryKey: ["pipeline-board"] });
      toast.success("Product added to deal");
      reset();
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const products = data?.items ?? [];

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a product</DialogTitle>
          <DialogDescription>
            {selected
              ? "Set the quantity and apply an offer if one is running."
              : "Pick from your catalog. The price is taken from the catalog, not typed in."}
          </DialogDescription>
        </DialogHeader>

        {selected ? (
          <div className="space-y-4">
            <div className="border-t pt-3">
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{selected.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {selected.price ? selected.price.amount_display : "No published price"}
                  </p>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(null)}>
                  Change
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="line-quantity">Quantity</Label>
              <Input
                id="line-quantity"
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
            </div>

            {selected.offers.length > 0 ? (
              <div className="space-y-1.5">
                <Label>Apply an offer</Label>
                <div className="space-y-1.5">
                  <button
                    type="button"
                    onClick={() => setOfferId(null)}
                    className={`flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                      offerId === null ? "border-brand bg-brand/5" : "hover:bg-muted"
                    }`}
                  >
                    No offer
                  </button>
                  {selected.offers.map((offer) => (
                    <button
                      key={offer.id}
                      type="button"
                      onClick={() => setOfferId(offer.id)}
                      className={`flex w-full flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${
                        offerId === offer.id ? "border-brand bg-brand/5" : "hover:bg-muted"
                      }`}
                    >
                      <Ticket className="size-3.5 shrink-0 text-amber-700 dark:text-amber-400" />
                      <span className="truncate">{offer.name}</span>
                      {offer.code ? (
                        <code className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">
                          {offer.code}
                        </code>
                      ) : null}
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                        {offer.discount_display} off
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
                {mutation.isPending ? "Adding..." : "Add to deal"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search the catalog"
                className="pl-9"
              />
            </div>

            <div className="max-h-72 space-y-1.5 overflow-y-auto">
              {isLoading && !data ? (
                <Skeleton className="h-40 w-full" />
              ) : products.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Nothing in the catalog matches. Connect a product and publish its
                  catalog, or add one manually from the Products page.
                </p>
              ) : (
                products.map((product) => (
                  <button
                    key={product.id}
                    type="button"
                    onClick={() => setSelected(product)}
                    className="flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left hover:bg-muted"
                  >
                    <Package className="size-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{product.name}</p>
                      {product.category ? (
                        <p className="truncate text-xs text-muted-foreground">
                          {product.category}
                        </p>
                      ) : null}
                    </div>
                    <span className="shrink-0 text-sm tabular-nums">
                      {product.price ? product.price.amount_display : "-"}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Products on a deal.
 *
 * When a deal has line items its value is DERIVED from them, so the header
 * total stops being editable by hand. That is called out in the UI rather than
 * left as a surprise when someone's typed figure gets overwritten.
 */
export function DealProductsTab({ dealId }: { dealId: string }) {
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = React.useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["deal-line-items", dealId],
    queryFn: () => listDealLineItems(dealId),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["deal-line-items", dealId] });
    void queryClient.invalidateQueries({ queryKey: ["deal", dealId] });
    void queryClient.invalidateQueries({ queryKey: ["pipeline-board"] });
  };

  const removeMutation = useMutation({
    mutationFn: (itemId: string) => removeDealLineItem(dealId, itemId),
    onSuccess: () => {
      invalidate();
      toast.success("Removed");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const quantityMutation = useMutation({
    mutationFn: (input: { itemId: string; quantity: number }) =>
      updateDealLineItem(dealId, input.itemId, { quantity: input.quantity }),
    onSuccess: invalidate,
    onError: (error: Error) => toast.error(error.message),
  });

  if (isLoading) return <Skeleton className="h-40 w-full" />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-3">
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed px-4 py-10 text-center">
          <Package className="mx-auto size-5 text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">
            No products on this deal yet. Add one and the deal value is calculated
            from the catalog price.
          </p>
          <Button type="button" size="sm" className="mt-4" onClick={() => setAddOpen(true)}>
            <Plus className="size-4" />
            Add a product
          </Button>
        </div>
      ) : (
        <>
          <ul className="space-y-2">
            {items.map((item) => (
              <li key={item.id} className="border-t pt-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{item.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.unit_price_display} each
                      {item.discount_minor > 0 ? (
                        <>
                          <span className="px-1">&middot;</span>
                          <span className="text-emerald-700 dark:text-emerald-400">
                            {item.discount_display} off
                          </span>
                        </>
                      ) : null}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Input
                      type="number"
                      min={1}
                      defaultValue={item.quantity}
                      aria-label={`Quantity for ${item.name}`}
                      className="h-8 w-16 text-center"
                      // Committed on blur, not on every keystroke: each change is
                      // a write plus a deal-value recompute.
                      onBlur={(e) => {
                        const next = Math.max(1, Number(e.target.value) || 1);
                        if (next !== item.quantity) {
                          quantityMutation.mutate({ itemId: item.id, quantity: next });
                        }
                      }}
                    />
                    <span className="w-24 text-right text-sm font-medium tabular-nums">
                      {item.total_display}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      disabled={removeMutation.isPending}
                      onClick={() => removeMutation.mutate(item.id)}
                      aria-label={`Remove ${item.name}`}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Deal total</p>
              <p className="text-xs text-muted-foreground">
                Calculated from these products
              </p>
            </div>
            <span className="text-lg font-semibold tabular-nums">{data?.total_display}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="size-4" />
              Add another
            </Button>
            <Badge variant="outline" className="ml-auto text-[10px]">
              Deal value is set by these lines
            </Badge>
          </div>
        </>
      )}

      <AddProductDialog dealId={dealId} open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}
