import { Download, Loader2 } from "lucide-react";
import * as React from "react";

interface Mp3DownloadButtonProps {
  url: string;
  filename: string;
  className?: string;
}

/**
 * Directly downloads a recording MP3 in the current tab via Blob fetch
 * (with Content-Disposition attachment fallback) so the browser never opens
 * a separate media tab.
 */
export function Mp3DownloadButton({ url, filename, className }: Mp3DownloadButtonProps) {
  const [downloading, setDownloading] = React.useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    const isLocalApiFile = url.includes("/local-files/");
    const targetUrl = isLocalApiFile
      ? `${url}${url.includes("?") ? "&" : "?"}download=1&filename=${encodeURIComponent(filename)}`
      : url;

    const triggerDownload = (href: string) => {
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
    };

    try {
      const response = await fetch(targetUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      triggerDownload(objectUrl);
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    } catch {
      triggerDownload(targetUrl);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleDownload()}
      disabled={downloading}
      className={
        className ??
        "inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 border rounded px-2.5 py-1 transition-colors h-7 shrink-0 shadow-sm disabled:opacity-60"
      }
      title="Download MP3 Recording"
    >
      {downloading ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Download className="size-3 text-slate-600 dark:text-slate-300" />
      )}
      MP3
    </button>
  );
}
