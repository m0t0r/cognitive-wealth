import "@testing-library/jest-dom/vitest";
// Registers the `toHaveNoA11yViolations` matcher.
// oxlint-disable-next-line import/no-unassigned-import
import "./axe";
import { cleanup, render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { userEvent, type UserEvent } from "@testing-library/user-event";
import type { ReactElement } from "react";
import { afterEach } from "vitest";

export * from "@testing-library/react";
export { userEvent };

// RTL only auto-cleans when Vitest globals are on; we keep them off.
afterEach(cleanup);

/** `render` plus a `user-event` instance set up before rendering, as user-event recommends. */
export function setup(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult & { user: UserEvent } {
  return { user: userEvent.setup(), ...render(ui, options) };
}
