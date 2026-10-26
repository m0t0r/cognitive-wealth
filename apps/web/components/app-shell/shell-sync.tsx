"use client";

import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, type ReactNode } from "react";

// Layouts don't re-render on client navigation, only the page does. When a page's request moved
// the viewer's session (a Removal or a deactivation, ADR 0022 and 0023), the page shows the new
// workspace while the layout still shows the old one, with no notice: the mix-up the notices are
// there to prevent. So the layout publishes its `shellKey` here, each page renders its own through
// `AppShellSync`, and a mismatch refreshes the route, layout included.

const ShellKeyContext = createContext<string | null>(null);

/** The layout's `shellKey`, for the page's `RefreshStaleShell` to compare. */
export function ShellKeyProvider({ value, children }: { value: string; children: ReactNode }) {
  return <ShellKeyContext value={value}>{children}</ShellKeyContext>;
}

/** Refreshes the route when the layout's `shellKey` isn't the page's. Renders nothing. */
export function RefreshStaleShell({ shellKey }: { shellKey: string }) {
  const rendered = useContext(ShellKeyContext);
  const router = useRouter();

  useEffect(() => {
    if (rendered !== null && rendered !== shellKey) router.refresh();
  }, [rendered, shellKey, router]);

  return null;
}
