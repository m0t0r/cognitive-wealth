import type { Metadata } from "next";
import { ConfirmSignIn } from "@/components/auth/confirm-sign-in";
import { currentViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Finish signing in" };

export default async function ConfirmPage() {
  const viewer = await currentViewer();
  return <ConfirmSignIn signedInAs={viewer?.user.email ?? null} />;
}
