"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/inputs";
import { useSession } from "@/lib/session";

export default function SignInPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post<{ user: { id: string } }>("/auth/login", { email, password });
      await refresh();
      router.replace("/app");
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError("Incorrect email or password.");
      } else if (err instanceof ApiError && err.status === 403) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Could not sign in.");
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-paper">Sign in</h1>
      <p className="mt-1.5 text-sm text-muted">
        Continue to the Aegis command center.
      </p>

      <form onSubmit={submit} className="mt-8 flex flex-col gap-4">
        <Field label="Work email">
          <Input
            type="email"
            autoComplete="email"
            placeholder="you@firm.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field label="Password">
          <Input
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">
            {error}
          </p>
        )}

        <Button type="submit" loading={busy} disabled={!email || !password || busy} size="lg">
          Sign in
        </Button>
      </form>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link href="/auth/sign-up" className="text-accent hover:text-accent-strong">
          Create an account
        </Link>
        <Link href="/auth/forgot-password" className="text-faint hover:text-muted">
          Forgot password?
        </Link>
      </div>
    </div>
  );
}