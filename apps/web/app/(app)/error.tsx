"use client";

import { Button } from "@repo/design-system/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@repo/design-system/components/empty";

export default function AppError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyTitle>
          <h1>Unable to load this page</h1>
        </EmptyTitle>
        <EmptyDescription>Check your connection, then try again.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button type="button" onClick={() => retry()}>
          Try again
        </Button>
      </EmptyContent>
    </Empty>
  );
}
