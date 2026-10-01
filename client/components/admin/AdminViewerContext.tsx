"use client";

import { createContext, useContext } from "react";

import type { SessionUser } from "@/types/auth";

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
