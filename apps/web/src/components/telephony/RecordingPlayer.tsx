import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";

import { Spinner } from "@/components/ui/spinner";
import { getRecordingUrl } from "@/lib/api/telephony";

// Direct inline player for call recordings.
// Rendered immediately so users don't have to tap twice (tap once to reveal, tap again to play).
// Uses preload="none" so audio bytes are only fetched when the user hits play.
export function RecordingPlayer({ callId }: { callId: string }) {
  const urlQuery = useQuery({
    queryKey: ["call-recording", callId],
    queryFn: () => getRecordingUrl(callId),
    staleTime: 30 * 60_000,
    retry: false,
  });

  if (urlQuery.isLoading) {
    return (
      <div className="flex items-center gap-1.5 py-1 text-xs text-muted-foreground">
        <Spinner size="sm" />
        <span className="text-[11px]">Loading audio…</span>
      </div>
    );
  }

  if (urlQuery.data?.pending) {
    return (
      <span className="py-1 text-[11px] text-amber-600 font-medium">
        Processing recording…
      </span>
    );
  }

  if (!urlQuery.data?.url) {
    return <span className="py-1 text-[11px] text-muted-foreground">Recording unavailable</span>;
  }

  return (
    <div className="flex items-center gap-2 py-0.5">
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        controls
        preload="none"
        src={urlQuery.data.url}
        className="h-8 w-48 sm:w-56 md:w-64 accent-brand rounded"
      />
      <a
        href={urlQuery.data.url}
        download={`recording-${callId}.mp3`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 border rounded px-2.5 py-1 transition-colors h-7 shrink-0 shadow-sm"
        title="Download MP3 Recording"
      >
        <Download className="size-3 text-slate-600" />
        MP3
      </a>
    </div>
  );
}
