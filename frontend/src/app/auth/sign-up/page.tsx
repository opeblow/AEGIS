"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { post, get, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/inputs";
import { useSession } from "@/lib/session";

export default function SignUpPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<"form" | "verify">("form");

  /** Dev-dashboard convenience: pull the verification token from the mailbox. */
  const autoVerify = async (m: string): Promise<boolean> => {
    try {
      const { messages } = await get<{
        messages: { kind: string; to: string; token: string }[];
      }>("/auth/dev/mailbox/tokens");
      const target = m.trim().toLowerCase();
      const msg = messages.find(
        (x) => x.kind === "EMAIL_VERIFICATION" && x.to.toLowerCase() === target,
      );
      if (!msg) return false;
      await post("/auth/verify-email", { token: msg.token });
      return true;
    } catch {
      return false;
    }
  };

  const pollVerify = async (m: string, attempts = 8): Promise<boolean> => {
    for (let i = 0; i < attempts; i++) {
      if (await autoVerify(m)) return true;
      await new Promise((r) => setTimeout(r, 600));
    }
    return false;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await post("/auth/register", { email, password });
      const verified = await pollVerify(email);
      if (verified) {
        await post("/auth/login", { email, password });
        await refresh();
        router.replace("/onboarding");
      } else {
        setStep("verify");
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setError("An account with this email already exists. Sign in instead.");
      } else {
        setError(err instanceof Error ? err.message : "Could not create account.");
      }
    } finally {
      setBusy(false);
    }
  };

  if (step === "verify") {
    return (
      <VerifyCard
        email={email}
        password={password}
        onDone={() => void refresh().then(() => router.replace("/app"))}
      />
    );
  }

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-paper">Create your account</h1>
      <p className="mt-1.5 text-sm text-muted">
        Aegis is invitation-first. Your account is created and your email
        verified before you can sign in.
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
        <Field label="Password" hint="At least 12 characters. Use a passphrase, not a word.">
          <Input
            type="password"
            autoComplete="new-password"
            placeholder="••••••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={12}
          />
        </Field>

        {error && (
          <p className="rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">
            {error}
          </p>
        )}

        <Button type="submit" loading={busy} disabled={!email || !password || busy} size="lg">
          Create account
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted">
        Already registered?{" "}
        <Link href="/auth/sign-in" className="text-accent hover:text-accent-strong">
          Sign in
        </Link>
      </p>
    </div>
  );
}

function VerifyCard({
  email,
  password,
  onDone,
}: {
  email: string;
  password: string;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    setBusy(true);
    setError(null);
    const ok = await pollEmail(email, password);
    if (ok) onDone();
    else {
      setError("Verification email not found yet. Use the dev mailbox and retry.");
      setBusy(false);
    }
  };

  return (
    <div className="w-full max-w-sm">
      <h1 className="text-2xl font-semibold tracking-tight text-paper">Verify your email</h1>
      <p className="mt-1.5 text-sm text-muted">
        A verification email was sent to{" "}
        <span className="mono text-paper">{email}</span>. Confirm the token from the
        development mailbox to continue.
      </p>
      {error && (
        <p className="mt-4 rounded-lg border border-rose/25 bg-rose-soft px-3 py-2 text-sm text-rose">
          {error}
        </p>
      )}
      <div className="mt-6">
        <Button onClick={check} loading={busy} size="lg" className="w-full">
          I&apos;ve verified — continue
        </Button>
      </div>
    </div>
  );
}

async function pollEmail(email: string, password: string): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    try {
      const { messages } = await get<{
        messages: { kind: string; to: string; token: string }[];
      }>("/auth/dev/mailbox/tokens");
      const target = email.trim().toLowerCase();
      const msg = messages.find(
        (x) => x.kind === "EMAIL_VERIFICATION" && x.to.toLowerCase() === target,
      );
      if (msg) {
        await post("/auth/verify-email", { token: msg.token });
        await post("/auth/login", { email, password });
        return true;
      }
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  return false;
}