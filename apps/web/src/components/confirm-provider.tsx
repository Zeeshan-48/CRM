import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  /** Style the confirm button as destructive (red) for delete/remove actions. */
  destructive?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = React.createContext<ConfirmFn | null>(null);

/**
 * App-level confirmation modal. Replaces the native window.confirm() with a
 * styled, accessible dialog. Usage:
 *
 *   const confirm = useConfirm();
 *   if (await confirm({ title: "Delete X?", destructive: true })) { ... }
 */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = React.useState<{
    options: ConfirmOptions;
    resolve: (value: boolean) => void;
  } | null>(null);

  const confirm = React.useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setState({ options, resolve })),
    []
  );

  const settle = React.useCallback(
    (value: boolean) => {
      setState((s) => {
        s?.resolve(value);
        return null;
      });
    },
    []
  );

  const opts = state?.options;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={!!state} onOpenChange={(open) => !open && settle(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{opts?.title}</DialogTitle>
            {opts?.description ? (
              <DialogDescription>{opts.description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => settle(false)}>
              {opts?.cancelText ?? "Cancel"}
            </Button>
            <Button
              variant={opts?.destructive ? "destructive" : "default"}
              onClick={() => settle(true)}
              autoFocus
            >
              {opts?.confirmText ?? "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within <ConfirmProvider>");
  return ctx;
}
