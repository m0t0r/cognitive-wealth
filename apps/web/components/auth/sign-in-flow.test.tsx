import { requestSignIn, verifyCode } from "@repo/auth/client";
import { act, render, screen, setup, userEvent } from "@repo/testing/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RESEND_COOLDOWN, SignInFlow } from "./sign-in-flow";

vi.mock("@repo/auth/client", () => ({ requestSignIn: vi.fn(), verifyCode: vi.fn() }));

const EMAIL = "ana@example.com";

const assign = vi.fn<(url: string | URL) => void>();

beforeEach(() => {
  vi.mocked(requestSignIn).mockResolvedValue({ ok: true });
  vi.mocked(verifyCode).mockResolvedValue({ ok: true });
  vi.spyOn(window.location, "assign").mockImplementation(assign);
});

afterEach(() => {
  vi.useRealTimers();
});

async function submitEmail(user: ReturnType<typeof userEvent.setup>, email = EMAIL) {
  await user.type(screen.getByLabelText("Email"), email);
  await user.click(screen.getByRole("button", { name: "Continue" }));
  return screen.findByRole("heading", { name: "Check your email" });
}

describe("SignInFlow", () => {
  it("asks for an email, then says to check it without promising it was sent", async () => {
    const { user, container } = setup(<SignInFlow next="/settings/members" arrivalError={null} />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("inputmode", "email");
    await expect(container).toHaveNoA11yViolations();

    const heading = await submitEmail(user);

    expect(requestSignIn).toHaveBeenCalledWith(EMAIL, "/settings/members");
    expect(heading).toHaveFocus();
    expect(screen.getByText(EMAIL)).toBeInTheDocument();
    expect(screen.getByText(/has access, you'll get an email/)).toHaveTextContent(
      "Both expire in 5 minutes.",
    );
    expect(screen.getByLabelText("Sign-in code")).toHaveAttribute("autocomplete", "one-time-code");
    await expect(container).toHaveNoA11yViolations();
  });

  it("leaves the callback path out when there's nowhere to come back to", async () => {
    const { user } = setup(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    expect(requestSignIn).toHaveBeenCalledWith(EMAIL, undefined);
  });

  it("explains an invalid address next to the field without sending anything", async () => {
    const { user, container } = setup(<SignInFlow next={null} arrivalError={null} />);
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    const field = screen.getByLabelText("Email");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription("Enter an email address, like name@example.com.");
    expect(requestSignIn).not.toHaveBeenCalled();
    await expect(container).toHaveNoA11yViolations();
  });

  it("shows a friendly message when sign-in requests are rate limited", async () => {
    vi.mocked(requestSignIn).mockResolvedValue({ ok: false, error: "rate_limited" });
    const { user } = setup(<SignInFlow next={null} arrivalError={null} />);
    await user.type(screen.getByLabelText("Email"), EMAIL);
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Wait a minute, then try again.");
    expect(screen.queryByRole("heading", { name: "Check your email" })).not.toBeInTheDocument();
  });

  it("shows the error the page arrived with", async () => {
    const { container } = setup(
      <SignInFlow next={null} arrivalError="That sign-in link has expired." />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("That sign-in link has expired.");
    await expect(container).toHaveNoA11yViolations();
  });

  it("signs in with the code and loads the next page in full", async () => {
    const { user } = setup(<SignInFlow next="/settings/members" arrivalError={null} />);
    await submitEmail(user);

    await user.type(screen.getByLabelText("Sign-in code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(verifyCode).toHaveBeenCalledWith(EMAIL, "123456");
    expect(assign).toHaveBeenCalledWith("/settings/members");
  });

  it("asks for all six digits before checking the code", async () => {
    const { user } = setup(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    await user.type(screen.getByLabelText("Sign-in code"), "123");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(screen.getByLabelText("Sign-in code")).toHaveAccessibleDescription(
      expect.stringContaining("Enter the 6-digit code from the email."),
    );
    expect(verifyCode).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_or_expired", "That code didn't work."],
    ["rate_limited", "Too many sign-in attempts."],
  ] as const)("explains a %s code", async (error, message) => {
    vi.mocked(verifyCode).mockResolvedValue({ ok: false, error });
    const { user, container } = setup(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    await user.type(screen.getByLabelText("Sign-in code"), "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Sign-in code")).toHaveAttribute("aria-invalid", "true");
    expect(assign).not.toHaveBeenCalled();
    await expect(container).toHaveNoA11yViolations();
  });

  it("clears a code error once the code is edited, and while a new try runs", async () => {
    vi.mocked(verifyCode).mockResolvedValueOnce({ ok: false, error: "invalid_or_expired" });
    const { user } = setup(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    const field = screen.getByLabelText("Sign-in code");
    await user.type(field, "123456");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work.");

    await user.type(field, "{Backspace}");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(field).not.toHaveAttribute("aria-invalid");
  });

  it("says the code is used up after its 3rd wrong try, and keeps saying so", async () => {
    // The server answers a used-up code like a wrong one (so it can't reveal who was sent a
    // code); the page counts the tries itself.
    vi.mocked(verifyCode).mockResolvedValue({ ok: false, error: "invalid_or_expired" });
    const { user } = setup(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    const field = screen.getByLabelText("Sign-in code");
    const tryCode = async (code: string) => {
      await user.clear(field);
      await user.type(field, code);
      await user.click(screen.getByRole("button", { name: "Sign in" }));
    };

    await tryCode("111111");
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work.");
    await tryCode("222222");
    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work.");
    await tryCode("333333");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries with this code.");
    await tryCode("444444");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries with this code.");
    expect(screen.getByRole("alert")).not.toHaveTextContent("didn't work");
  });

  it("starts counting again after a new email", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(verifyCode).mockResolvedValue({ ok: false, error: "invalid_or_expired" });
    render(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    const tryCode = async (code: string) => {
      const field = screen.getByLabelText("Sign-in code");
      await user.clear(field);
      await user.type(field, code);
      await user.click(screen.getByRole("button", { name: "Sign in" }));
    };
    await tryCode("111111");
    await tryCode("222222");
    await tryCode("333333");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries with this code.");

    for (let second = 0; second < RESEND_COOLDOWN; second++) {
      // One tick per second: each re-render schedules the next one.
      // oxlint-disable-next-line no-await-in-loop
      await act(() => vi.advanceTimersByTimeAsync(1000));
    }
    await user.click(screen.getByRole("button", { name: "Resend email" }));
    await tryCode("444444");

    expect(await screen.findByRole("alert")).toHaveTextContent("That code didn't work.");
  });

  it("says it's for an invitation, without naming the workspace", () => {
    setup(<SignInFlow next="/invite/abc" arrivalError={null} purpose="invitation" />);
    expect(
      screen.getByRole("heading", { name: "Sign in to view your invitation" }),
    ).toBeInTheDocument();
  });

  it("goes back to the email field, keeping the address", async () => {
    const { user } = setup(<SignInFlow next={null} arrivalError={null} />);
    await submitEmail(user);
    await user.click(screen.getByRole("button", { name: "Use a different email" }));

    const field = screen.getByLabelText("Email");
    expect(field).toHaveFocus();
    expect(field).toHaveValue(EMAIL);
  });

  it("lets people resend only after the cooldown", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = render(<SignInFlow next="/x" arrivalError={null} />);
    await submitEmail(user);

    const resend = screen.getByRole("button", { name: `Resend email in ${RESEND_COOLDOWN}s` });
    expect(resend).toHaveAttribute("aria-disabled", "true");
    await user.click(resend);
    expect(requestSignIn).toHaveBeenCalledTimes(1);

    // One tick per second: each re-render schedules the next one.
    for (let second = 1; second < RESEND_COOLDOWN; second++) {
      // oxlint-disable-next-line no-await-in-loop
      await act(() => vi.advanceTimersByTimeAsync(1000));
    }
    expect(screen.getByRole("button", { name: "Resend email in 1s" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(1000));

    await user.click(screen.getByRole("button", { name: "Resend email" }));
    expect(requestSignIn).toHaveBeenCalledTimes(2);
    expect(requestSignIn).toHaveBeenLastCalledWith(EMAIL, "/x");
    expect(await screen.findByRole("status")).toHaveTextContent(
      `If ${EMAIL} has access, a new email is on its way.`,
    );
    expect(
      screen.getByRole("button", { name: `Resend email in ${RESEND_COOLDOWN}s` }),
    ).toBeInTheDocument();
    await expect(container).toHaveNoA11yViolations();
  });
});
