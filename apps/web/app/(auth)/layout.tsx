/** Sign-in, invitation and onboarding pages: one narrow column, centered on the screen. */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-svh flex-col items-center px-4 py-10 sm:justify-center sm:py-16">
      <main className="flex w-full max-w-sm flex-col gap-6">
        <p className="text-center font-heading text-sm font-semibold tracking-tight">
          Cognitive Wealth
        </p>
        {children}
      </main>
    </div>
  );
}
