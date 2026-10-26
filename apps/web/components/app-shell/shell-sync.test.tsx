import { setup } from "@repo/testing/react";
import { RefreshStaleShell, ShellKeyProvider } from "./shell-sync";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

describe("RefreshStaleShell", () => {
  it("refreshes the route when the layout shows another viewer state than the page", () => {
    setup(
      <ShellKeyProvider value="in Acme">
        <RefreshStaleShell shell="in Globex, removed from Acme" />
      </ShellKeyProvider>,
    );
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("leaves an up-to-date layout alone", () => {
    setup(
      <ShellKeyProvider value="in Acme">
        <RefreshStaleShell shell="in Acme" />
      </ShellKeyProvider>,
    );
    expect(refresh).not.toHaveBeenCalled();
  });
});
