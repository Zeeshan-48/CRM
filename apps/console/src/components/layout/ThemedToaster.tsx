import * as React from "react";
import { Toaster } from "sonner";

import { getTheme, THEME_CHANGE_EVENT, type Theme } from "@/lib/theme";

/** Sonner toaster that follows the console theme (dark default). */
export function ThemedToaster() {
  const [theme, setTheme] = React.useState<Theme>(() => getTheme());

  React.useEffect(() => {
    const onChange = (event: Event) => {
      setTheme((event as CustomEvent<Theme>).detail);
    };
    window.addEventListener(THEME_CHANGE_EVENT, onChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange);
  }, []);

  return <Toaster position="top-right" richColors closeButton theme={theme} offset={{ top: 72 }} />;
}
