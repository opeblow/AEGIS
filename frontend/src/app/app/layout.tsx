"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { SessionProvider, useSession } from "@/lib/session";
import { ToastProvider } from "@/components/ui/toast";

function Gate({ children }: { children: ReactNode }) {
  const { loading, user, activeOrg } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/auth/sign-in");
  }, [loading, user, router]);

  if (loading || !user || !activeOrg) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse-soft flex items-center gap-2 text-sm text-faintest">
          <span className="size-1.5 rounded-full bg-accent" />
          Verifying session…
        </div>
      </div>
    );
  }
  return <AppShell>{children}</AppShell>;
}

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ToastProvider>
        <Gate>{children}</Gate>
      </ToastProvider>
    </SessionProvider>
  );
}