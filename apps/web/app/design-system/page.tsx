import { Separator } from "@repo/design-system/components/separator";
import { AiPreview } from "@/components/preview/ai";
import { FoundationsPreview } from "@/components/preview/foundations";

export default function DesignSystemPage() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-4 py-12 sm:px-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-heading text-3xl font-semibold tracking-tight">Design system</h1>
        <p className="text-muted-foreground">
          Preview of <code className="font-mono text-sm">@repo/design-system</code>. Press{" "}
          <kbd className="font-mono text-sm">d</kbd> to toggle dark mode.
        </p>
      </header>
      <FoundationsPreview />
      <Separator />
      <AiPreview />
    </main>
  );
}
