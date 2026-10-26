import { RefreshStaleShell } from "@/components/app-shell/shell-sync";
import { requireAppViewer } from "@/lib/auth/viewer";
import { shellKey } from "@/lib/shell-key";

/**
 * Brings the app layout up to date when this page's request found the viewer somewhere else
 * (`shell-sync.tsx`). Every app page renders it once; the viewer lookup is the page's own (cached).
 */
export async function AppShellSync() {
  return <RefreshStaleShell shellKey={shellKey(await requireAppViewer())} />;
}
