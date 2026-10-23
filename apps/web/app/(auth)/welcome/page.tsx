import { sanitizeCallbackPath } from "@repo/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@repo/design-system/components/card";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NameForm } from "@/components/auth/name-form";
import { requireViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Welcome" };

export default async function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  const { next } = await searchParams;
  const nextPath = sanitizeCallbackPath(typeof next === "string" ? next : null);
  const viewer = await requireViewer();
  if (viewer.user.name.trim() !== "") redirect(nextPath ?? "/");

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1 className="font-heading text-xl">Welcome to Cognitive Wealth</h1>
        </CardTitle>
        <CardDescription>
          Add your name so people in your workspace know who you are.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <NameForm next={nextPath} />
      </CardContent>
    </Card>
  );
}
