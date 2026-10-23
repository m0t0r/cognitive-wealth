import type { Metadata } from "next";
import { ConfirmSignIn } from "@/components/auth/confirm-sign-in";

export const metadata: Metadata = { title: "Finish signing in" };

export default function ConfirmPage() {
  return <ConfirmSignIn />;
}
