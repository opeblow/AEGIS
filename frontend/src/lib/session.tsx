"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { get, post } from "./api";
import type { ApiUser, OrganizationMember } from "./types";

interface SessionState {
  user: ApiUser | null;
  members: OrganizationMember[];
  loading: boolean;
  activeOrg: OrganizationMember | null;
  refresh: () => Promise<void>;
  setActiveOrg: (m: OrganizationMember) => void;
  signOut: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeOrgId, setActiveOrgId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      // 6-second timeout so we never hang forever when the backend is unreachable
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      const [me, orgs] = await Promise.all([
        get<{ user: ApiUser }>("/auth/me", { signal: controller.signal }),
        get<{ organizations: OrganizationMember[] }>("/organizations", { signal: controller.signal }),
      ]).finally(() => clearTimeout(timer));
      setUser(me.user);
      setMembers(orgs.organizations);
      setActiveOrgId((prev) => {
        if (prev && orgs.organizations.some((m) => m.organizationId === prev)) {
          return prev;
        }
        const active = orgs.organizations.find((m) => m.role === "OWNER");
        return active?.organizationId ?? orgs.organizations[0]?.organizationId ?? null;
      });
    } catch {
      setUser(null);
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh();
  }, [refresh]);

  const activeOrg = useMemo(
    () => members.find((m) => m.organizationId === activeOrgId) ?? null,
    [members, activeOrgId],
  );

  const setActiveOrg = useCallback((m: OrganizationMember) => {
    setActiveOrgId(m.organizationId);
  }, []);

  const signOut = useCallback(async () => {
    try {
      await post("/auth/logout");
    } finally {
      setUser(null);
      setMembers([]);
    }
  }, []);

  const value = useMemo(
    () => ({ user, members, loading, activeOrg, refresh, setActiveOrg, signOut }),
    [user, members, loading, activeOrg, refresh, setActiveOrg, signOut],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionState {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within SessionProvider");
  return ctx;
}