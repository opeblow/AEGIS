"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, Orbit } from "lucide-react";
import { SessionProvider, useSession } from "@/lib/session";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthGate>{children}</AuthGate>
    </SessionProvider>
  );
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user) router.replace("/app");
  }, [loading, user, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-pulse-soft flex items-center gap-2 text-sm text-faintest">
          <span className="size-1.5 rounded-full bg-accent" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen flex-col">
      <Link
        href="/"
        className="focus-ring absolute top-5 left-5 flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-faint transition-colors hover:text-muted"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <div className="flex flex-1 flex-col items-center justify-center px-4 py-12">
        <Link href="/" className="mb-8 flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg border border-accent/30 bg-accent-soft">
            <Orbit className="size-4 text-accent" />
          </span>
          <span className="text-base font-semibold tracking-tight text-paper">Aegis</span>
        </Link>
        {children}
      </div>
    </div>
  );
}