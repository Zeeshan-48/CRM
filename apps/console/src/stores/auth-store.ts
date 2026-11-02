import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { OperatorUser } from "@/types";

interface AuthState {
  token: string | null;
  user: OperatorUser | null;
  setAuth: (token: string, user: OperatorUser) => void;
  setUser: (user: OperatorUser) => void;
  clear: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      user: null,
      setAuth: (token, user) => set({ token, user }),
      setUser: (user) => set({ user }),
      clear: () => set({ token: null, user: null }),
    }),
    {
      name: "operator-auth",
    }
  )
);

/** True when the signed-in operator may perform write actions. */
export const isSuperadmin = (user: OperatorUser | null | undefined): boolean =>
  user?.role === "SUPERADMIN";
