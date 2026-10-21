"use client";

import { createContext, useCallback, useContext } from "react";

import { can, type SessionUser } from "@/types/auth";

/**
 * Who is using the panel, for client components that sit below a Server
 * Component and cannot be handed the session as a prop — the contextual Help
 * button rendered by every page header, for one. The shell sets it once from
 * the session the layout already resolved; nothing here makes a request.
 */
const AdminViewerContext = createContext<SessionUser | null>(null);

export function AdminViewerProvider({
  user,
  children,
}: {
  user: SessionUser;
  children: React.ReactNode;
}) {
  return <AdminViewerContext.Provider value={user}>{children}</AdminViewerContext.Provider>;
}

/** The signed-in staff member, or null outside the panel shell. */
export function useAdminViewer(): SessionUser | null {
  return useContext(AdminViewerContext);
}

/**
 * `can()` for a client component: whether the viewer holds any of the named
 * capabilities. Outside the shell nobody holds anything, so a control built
 * on this fails closed. The same rule as the server's `requireCapability`,
 * which still decides on its own — this only keeps a button from promising
 * what would answer 403.
 */
export function useCan(): (...anyOf: string[]) => boolean {
  const viewer = useAdminViewer();
  return useCallback((...anyOf: string[]) => can(viewer, ...anyOf), [viewer]);
}
