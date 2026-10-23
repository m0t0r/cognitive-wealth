import { SparklesIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { can } from "@repo/auth/access";
import { buttonVariants } from "@repo/design-system/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@repo/design-system/components/empty";
import type { Metadata } from "next";
import Link from "next/link";
import { YOUR_ROLE } from "@/lib/roles";
import { requireAppViewer } from "@/lib/auth/viewer";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const { user, tenant } = await requireAppViewer();

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-8">
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Welcome, {user.name}</h1>
        <p className="text-muted-foreground">{YOUR_ROLE[tenant.role](tenant.organization.name)}</p>
      </header>
      <Empty className="border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <HugeiconsIcon icon={SparklesIcon} strokeWidth={2} aria-hidden />
          </EmptyMedia>
          <EmptyTitle>
            <h2>More is on the way</h2>
          </EmptyTitle>
          <EmptyDescription>
            Tools for {tenant.organization.name} will appear here as they&apos;re ready.
          </EmptyDescription>
        </EmptyHeader>
        {can(tenant.role, "invitation:create") ? (
          <EmptyContent>
            <Link href="/settings/members" className={buttonVariants()}>
              Invite people
            </Link>
          </EmptyContent>
        ) : null}
      </Empty>
    </div>
  );
}
