import { useQuery } from "@tanstack/react-query";
import { Headphones } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { getRecordingUrl } from "@/lib/api/telephony";

// Inline player for a call recording. The <audio> element cannot send a JWT,
// so the URL comes from an authed endpoint that returns a short-lived
// presigned link; it is only fetched when the user actually expands the
// player (recordings are big, lists are long).
export function RecordingPlayer({ callId }: { callId: string }) {
  const [open, setOpen] = React.useState(false);
  const urlQuery = useQuery({
    queryKey: ["call-recording", callId],
    queryFn: () => getRecordingUrl(callId),
    enabled: open,
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (!open) {
    return (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Headphones className="size-3.5" />
        Play recording
      </Button>
    );
  }

  if (urlQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 py-1 text-xs text-muted-foreground">
        <Spinner size="sm" /> Loading recording…
      </div>
    );
  }

  if (urlQuery.data?.pending) {
    return (
      <p className="py-1 text-xs text-muted-foreground">
        Recording is still processing. Try again in a minute.
      </p>
    );
  }

  if (!urlQuery.data?.url) {
    return <p className="py-1 text-xs text-muted-foreground">Recording unavailable.</p>;
  }

  return (
    // preload="none": the presigned URL is already fetched, but the audio bytes
    // only stream once the user presses play. Call recordings have no caption
    // track to offer.
    // eslint-disable-next-line jsx-a11y/media-has-caption
    <audio controls preload="none" src={urlQuery.data.url} className="h-9 w-full max-w-sm" />
  );
}
