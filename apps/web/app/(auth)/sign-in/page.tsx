import { sanitizeCallbackPath } from "@repo/auth";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignInFlow } from "@/components/auth/sign-in-flow";
import { arrivalErrorMessage } from "@/lib/auth/messages";
import { currentViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next, error } = await searchParams;
  const nextPath = sanitizeCallbackPath(typeof next === "string" ? next : null);
  const errorCode = typeof error === "string" ? error : null;

  // Already signed in: go where the link was headed. With an error, stay and explain it.
  if (errorCode === null && (await currentViewer()) !== null) redirect(nextPath ?? "/");

  // Coming from an invitation link: say so, without naming the workspace to a signed-out visitor.
  const purpose = nextPath?.startsWith("/invite/") ? "invitation" : null;
  return (
    <SignInFlow next={nextPath} arrivalError={arrivalErrorMessage(errorCode)} purpose={purpose} />
  );
}
