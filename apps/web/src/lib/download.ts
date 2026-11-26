/**
 * Downloads a recording file directly in the current tab without navigating
 * away or opening a blank media preview tab.
 */
export async function downloadRecordingFile(url: string, filename: string): Promise<void> {
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
    // Fallback if cross-origin storage restricts fetch(); still omits target="_blank"
    // so Content-Disposition: attachment triggers a direct browser download.
    triggerDownload(targetUrl);
  }
}
