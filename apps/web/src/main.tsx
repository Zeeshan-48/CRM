import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./index.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";

import { ConfirmProvider } from "@/components/confirm-provider";
import { initTheme } from "@/lib/theme";
import { router } from "@/routes";

initTheme();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConfirmProvider>
        <RouterProvider router={router} />
      </ConfirmProvider>
      <Toaster position="top-right" richColors closeButton offset={{ top: 72 }} />
    </QueryClientProvider>
  </StrictMode>
);
