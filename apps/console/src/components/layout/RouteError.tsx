import { isRouteErrorResponse, useRouteError } from "react-router-dom";

import { Button } from "@/components/ui/button";

/**
 * Shown instead of a blank screen when a page throws while rendering or its
 * chunk fails to load (typically after a new deploy replaced the old chunks).
 */
export default function RouteError() {
  const error = useRouteError();
  const status = isRouteErrorResponse(error) ? error.status : null;
  const chunkGone =
    error instanceof Error && /dynamically imported module|Loading chunk/i.test(error.message);

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-3 px-6">
      <h1 className="text-lg font-semibold">
        {status === 404 ? "Page not found" : "Something went wrong"}
      </h1>
      <p className="text-sm text-muted-foreground">
        {chunkGone
          ? "A newer version of the app is available. Reload to continue."
          : "This page could not be shown. Reload to try again; if it keeps happening, tell your administrator."}
      </p>
      <div>
        <Button size="sm" onClick={() => window.location.reload()}>
          Reload
        </Button>
      </div>
    </main>
  );
}
