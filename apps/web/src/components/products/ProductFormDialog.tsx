import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import * as React from "react";
import { toast } from "sonner";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createProduct, updateProduct, type Product } from "@/lib/api/products";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
const PERIODS: Array<{ value: string; label: string }> = [
  { value: "ONE_TIME", label: "One-time" },
  { value: "MONTHLY", label: "Per month" },
  { value: "QUARTERLY", label: "Per quarter" },
  { value: "YEARLY", label: "Per year" },
];

// Currencies with no minor unit. Everything else is assumed to have 2, matching
// the backend's ISO 4217 table.
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF"]);
const factorFor = (currency: string): number => (ZERO_DECIMAL.has(currency) ? 1 : 100);

interface PriceRow {
  currency: string;
  amount: string;
  compareAt: string;
  period: string;
  isDefault: boolean;
}

const emptyPrice = (): PriceRow => ({
  currency: "INR",
  amount: "",
  compareAt: "",
  period: "ONE_TIME",
  isDefault: true,
});

/**
 * Create or edit a CRM-native product.
 *
 * Prices are typed in NORMAL units here (4999, not 499900) and converted on
 * submit. Minor units are a wire-format detail between systems; asking a sales
 * admin to type paise would guarantee a 100x mistake eventually.
 */
export function ProductFormDialog({
  product,
  open,
  onOpenChange,
}: {
  /** Omit to create. Pass a MANUAL product to edit. */
  product?: Product | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const editing = !!product;

  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [category, setCategory] = React.useState("");
  const [url, setUrl] = React.useState("");
  const [highlights, setHighlights] = React.useState("");
  const [prices, setPrices] = React.useState<PriceRow[]>([emptyPrice()]);

  // Reseed whenever the dialog opens on a different product.
  React.useEffect(() => {
    if (!open) return;
    setName(product?.name ?? "");
    setDescription(product?.description ?? "");
    setCategory(product?.category ?? "");
    setUrl(product?.url ?? "");
    setHighlights((product?.highlights ?? []).join("\n"));
    setPrices(
      product && product.prices.length
        ? product.prices.map((p) => ({
            currency: p.currency,
            amount: String(p.amount_minor / factorFor(p.currency)),
            compareAt:
              p.compare_at_minor === null
                ? ""
                : String(p.compare_at_minor / factorFor(p.currency)),
            period: p.billing_period,
            isDefault: p.is_default,
          }))
        : [emptyPrice()]
    );
    // Seeding only. Reseeding on every `product` reference change would discard
    // in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, product?.id]);

  const body = () => ({
    name: name.trim(),
    description: description.trim() || null,
    category: category.trim() || null,
    url: url.trim() || null,
    highlights: highlights
      .split("\n")
      .map((h) => h.trim())
      .filter(Boolean),
    prices: prices
      .filter((p) => p.amount.trim() !== "")
      .map((p) => {
        const factor = factorFor(p.currency);
        const compareAt = Number(p.compareAt);
        return {
          currency: p.currency,
          amount_minor: Math.round(Number(p.amount) * factor),
          compare_at_minor:
            p.compareAt.trim() && Number.isFinite(compareAt)
              ? Math.round(compareAt * factor)
              : null,
          billing_period: p.period,
          is_default: p.isDefault,
        };
      }),
  });

  const mutation = useMutation({
    mutationFn: () =>
      editing ? updateProduct(product.id, body()) : createProduct(body()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      void queryClient.invalidateQueries({ queryKey: ["product-categories"] });
      toast.success(editing ? "Product updated" : "Product created");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const setPrice = (index: number, patch: Partial<PriceRow>) => {
    setPrices((rows) =>
      rows.map((row, i) => {
        if (i !== index) {
          // Only one default per currency, so selecting one clears the others
          // in the same currency rather than letting the server pick.
          if (patch.isDefault && row.currency === rows[index].currency) {
            return { ...row, isDefault: false };
          }
          return row;
        }
        return { ...row, ...patch };
      })
    );
  };

  const invalidAmount = prices.some(
    (p) => p.amount.trim() !== "" && !Number.isFinite(Number(p.amount))
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit product" : "Add a product"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "This product lives in the CRM, so you can change it here."
              : "For things your connected products do not publish, like a service or a custom bundle."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="p-category">Category</Label>
              <Input
                id="p-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="Consulting"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="p-url">Link</Label>
              <Input
                id="p-url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://..."
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-description">Description</Label>
            <Textarea
              id="p-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="p-highlights">Selling points</Label>
            <Textarea
              id="p-highlights"
              rows={3}
              value={highlights}
              onChange={(e) => setHighlights(e.target.value)}
              placeholder={"12 weeks\nLive mentorship\nPlacement support"}
            />
            <p className="text-xs text-muted-foreground">
              One per line. These are the bullets an agent reads out on a call.
            </p>
          </div>

          {/* ---- Prices ---- */}
          <div className="space-y-2">
            <Label>Pricing</Label>
            {prices.map((price, index) => (
              <div key={index} className="space-y-2 border-t pt-3">
                <div className="flex items-center gap-2">
                  <Select
                    value={price.currency}
                    onValueChange={(value) => setPrice(index, { currency: value })}
                  >
                    <SelectTrigger className="w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Input
                    value={price.amount}
                    onChange={(e) => setPrice(index, { amount: e.target.value })}
                    placeholder="4999"
                    inputMode="decimal"
                    aria-label="Price"
                  />

                  <Select
                    value={price.period}
                    onValueChange={(value) => setPrice(index, { period: value })}
                  >
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PERIODS.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {p.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {prices.length > 1 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-destructive"
                      onClick={() => setPrices((rows) => rows.filter((_, i) => i !== index))}
                      aria-label="Remove this price"
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Input
                    value={price.compareAt}
                    onChange={(e) => setPrice(index, { compareAt: e.target.value })}
                    placeholder="Was (optional)"
                    inputMode="decimal"
                    className="h-8 w-36"
                    aria-label="Original price"
                  />
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name={`default-${price.currency}`}
                      checked={price.isDefault}
                      onChange={() => setPrice(index, { isDefault: true })}
                    />
                    Show this one by default
                  </label>
                </div>
              </div>
            ))}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setPrices((rows) => [...rows, { ...emptyPrice(), isDefault: false }])}
            >
              <Plus className="size-4" />
              Another currency or plan
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!name.trim() || invalidAmount || mutation.isPending}
          >
            {mutation.isPending ? "Saving..." : editing ? "Save changes" : "Add product"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
