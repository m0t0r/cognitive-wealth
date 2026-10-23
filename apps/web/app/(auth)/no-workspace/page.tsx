import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "No workspace yet" };

export default async function NoWorkspacePage() {
  const viewer = await requireViewer();
  if (viewer.tenant !== null) redirect("/");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl">You&apos;re not in a workspace yet</h1>
        </CardTitle>
        <CardDescription>
          Cognitive Wealth is invite-only. If someone invited you, open the link in their invitation
          email. Otherwise, ask a workspace owner or admin to invite{" "}
          <span className="font-medium wrap-anywhere text-foreground">{viewer.user.email}</span>.
        </CardDescription>
      </CardHeader>
      <CardFooter>
        <SignOutButton variant="outline" size="lg" className="w-full" />
      </CardFooter>
    </Card>
  );
}
