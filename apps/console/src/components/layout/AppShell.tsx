import { Navigate, Outlet } from "react-router-dom";

import { SideNav } from "@/components/layout/SideNav";
import { TopBar } from "@/components/layout/TopBar";
import { useAuthStore } from "@/stores/auth-store";

export default function AppShell() {
  const token = useAuthStore((s) => s.token);

  if (!token) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen bg-background">
      <TopBar />
      <div className="flex">
        <SideNav />
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1200px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
