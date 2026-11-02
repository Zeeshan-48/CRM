import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { createOffer, listProducts, updateOffer, type OfferRow } from "@/lib/api/products";

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD"];
const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "UGX", "XAF", "XOF", "XPF"]);
const ANY_PRODUCT = "__any__";

/** ISO date for a date input, or "" when absent. */
const toDateInput = (value: string | null): string =>
  value ? new Date(value).toISOString().slice(0, 10) : "";

/**
 * Create or edit an offer. A code makes it a coupon; leave it blank and the
 * discount just applies. One form, because to a salesperson they are the same
 * thing.
 */
export function OfferFormDialog({
  offer,
  open,
  onOpenChange,
}: {
  offer?: OfferRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const editing = !!offer;

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [type, setType] = React.useState<"PERCENT" | "FLAT">("PERCENT");
  const [value, setValue] = React.useState("");
  const [currency, setCurrency] = React.useState("INR");
  const [productId, setProductId] = React.useState(ANY_PRODUCT);
  const [startsAt, setStartsAt] = React.useState("");
  const [endsAt, setEndsAt] = React.useState("");
  const [maxRedemptions, setMaxRedemptions] = React.useState("");
  const [terms, setTerms] = React.useState("");

  const { data: catalog } = useQuery({
    queryKey: ["offer-product-options"],
    queryFn: () => listProducts({ limit: 100 }),
    enabled: open,
  });

  React.useEffect(() => {
    if (!open) return;
    setName(offer?.name ?? "");
    setCode(offer?.code ?? "");
    setType((offer?.discount_type as "PERCENT" | "FLAT") ?? "PERCENT");
    setValue(
      offer
        ? offer.discount_type === "PERCENT"
          ? String(offer.discount_value)
          : String(offer.discount_value / (ZERO_DECIMAL.has(offer.currency ?? "INR") ? 1 : 100))
        : ""
    );
    setCurrency(offer?.currency ?? "INR");
    setProductId(offer?.product_id ?? ANY_PRODUCT);
    setStartsAt(toDateInput(offer?.starts_at ?? null));
    setEndsAt(toDateInput(offer?.ends_at ?? null));
    setMaxRedemptions(offer?.max_redemptions ? String(offer.max_redemptions) : "");
    setTerms(offer?.terms ?? "");
    // Seeding only. Reseeding on every `offer` reference change would discard
    // in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, offer?.id]);

  const body = () => {
    const factor = ZERO_DECIMAL.has(currency) ? 1 : 100;
    return {
      name: name.trim(),
      code: code.trim() || null,
      discount_type: type,
      // A percentage is a plain number; a flat amount is typed in normal units
      // and converted, same rule as the product form.
      discount_value:
        type === "PERCENT" ? Math.round(Number(value)) : Math.round(Number(value) * factor),
      // The backend drops a currency on a PERCENT offer anyway (it is
      // currency-agnostic), so only send it when it means something.
      currency: type === "FLAT" ? currency : null,
      product_id: productId === ANY_PRODUCT ? null : productId,
      starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
      max_redemptions: maxRedemptions ? Number(maxRedemptions) : null,
      terms: terms.trim() || null,
    };
  };

  const mutation = useMutation({
    mutationFn: () => (editing ? updateOffer(offer.id, body()) : createOffer(body())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["offers"] });
      void queryClient.invalidateQueries({ queryKey: ["products"] });
      toast.success(editing ? "Offer updated" : "Offer created");
      onOpenChange(false);
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const numeric = Number(value);
  const invalid =
    !name.trim() ||
    !Number.isFinite(numeric) ||
    numeric <= 0 ||
    (type === "PERCENT" && numeric > 100) ||
    (!!startsAt && !!endsAt && endsAt < startsAt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit offer" : "New offer"}</DialogTitle>
          <DialogDescription>
            Give it a code and it becomes a coupon your agents can read out. Leave the
            code blank and it simply applies.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="o-name">Name</Label>
            <Input
              id="o-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Summer launch, 20% off"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="o-code">Coupon code</Label>
            <Input
              id="o-code"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="AUG20"
              className="font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="offerformdialog-discount">Discount</Label>
              <Select value={type} onValueChange={(v) => setType(v as "PERCENT" | "FLAT")}>
                <SelectTrigger id="offerformdialog-discount">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PERCENT">Percentage off</SelectItem>
                  <SelectItem value="FLAT">Fixed amount off</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-value">{type === "PERCENT" ? "Percent" : "Amount"}</Label>
              <div className="flex gap-2">
                {type === "FLAT" ? (
                  <Select value={currency} onValueChange={setCurrency}>
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
                ) : null}
                <Input
                  id="o-value"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={type === "PERCENT" ? "20" : "500"}
                />
              </div>
            </div>
          </div>

          {type === "FLAT" ? (
            <p className="text-xs text-muted-foreground">
              A fixed discount only applies to prices in {currency}. Use a percentage if
              you sell in several currencies.
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="offerformdialog-applies-to">Applies to</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="offerformdialog-applies-to">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ANY_PRODUCT}>Every product</SelectItem>
                {(catalog?.items ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="o-start">Starts</Label>
              <Input
                id="o-start"
                type="date"
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="o-end">Ends</Label>
              <Input
                id="o-end"
                type="date"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="o-max">Limit uses</Label>
            <Input
              id="o-max"
              type="number"
              min={1}
              value={maxRedemptions}
              onChange={(e) => setMaxRedemptions(e.target.value)}
              placeholder="Leave blank for unlimited"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="o-terms">Terms</Label>
            <Textarea
              id="o-terms"
              rows={2}
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              placeholder="New customers only. Not stackable."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={invalid || mutation.isPending}>
            {mutation.isPending ? "Saving..." : editing ? "Save changes" : "Create offer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
