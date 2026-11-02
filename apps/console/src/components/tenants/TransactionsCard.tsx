import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";

import { listTransactions } from "@/lib/api/billing";
import { formatDate, formatMoney } from "@/lib/format";
import type { PlatformTxnStatus } from "@/types";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const TXN_VARIANT: Record<PlatformTxnStatus, "success" | "warning" | "destructive" | "secondary"> = {
  PAID: "success",
  PENDING: "warning",
  FAILED: "destructive",
  REFUNDED: "secondary",
};

const money = (paise: number, currency: string) => formatMoney(paise / 100, currency);

interface Props {
  tenantId: string;
}

export function TransactionsCard({ tenantId }: Props) {
  const query = useQuery({
    queryKey: ["tenant-transactions", tenantId],
    queryFn: () => listTransactions(tenantId),
    enabled: Boolean(tenantId),
  });

  const rows = query.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Receipt className="size-4 text-muted-foreground" />
          Billing transactions
        </CardTitle>
      </CardHeader>
      <CardContent className="px-0">
        {query.isLoading ? (
          <div className="space-y-2 px-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-9" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="px-5 text-sm text-muted-foreground">No transactions yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Date</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-5">Gateway</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((txn) => (
                <TableRow key={txn.id}>
                  <TableCell className="pl-5 text-muted-foreground">
                    {formatDate(txn.occurred_at)}
                  </TableCell>
                  <TableCell className="capitalize">{txn.kind.toLowerCase()}</TableCell>
                  <TableCell className="text-right font-medium">
                    {money(txn.amount, txn.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={TXN_VARIANT[txn.status]}>{txn.status}</Badge>
                  </TableCell>
                  <TableCell className="pr-5">{txn.gateway}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
