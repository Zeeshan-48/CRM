import * as React from "react";

/**
 * `useState` whose value is mirrored to `sessionStorage` under `key`, so it
 * survives navigating away and back within the same tab session, e.g. a list
 * page's filters surviving a round-trip to a detail page and back, without
 * leaking across browser restarts (sessionStorage clears when the tab closes).
 *
 * For an object `initial`, a stored value is shallow-merged OVER the initial, so
 * keys added to the shape later still fall back to their default when an older
 * stored object is read. The API mirrors `useState` exactly, so it's a drop-in.
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [state, setState] = React.useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw == null) return initial;
      const parsed = JSON.parse(raw) as T;
      // Merge over the default for plain objects so new keys keep their default.
      if (
        initial &&
        typeof initial === "object" &&
        !Array.isArray(initial) &&
        parsed &&
        typeof parsed === "object"
      ) {
        return { ...initial, ...(parsed as object) } as T;
      }
      return parsed;
    } catch {
      return initial;
    }
  });

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage disabled or full, persistence is best-effort, never fatal */
    }
  }, [key, state]);

  return [state, setState];
}
