import type { Metadata } from "next";
import { Geist_Mono, Inter, Noto_Sans } from "next/font/google";
import "@repo/design-system/globals.css";
import { Toaster } from "@repo/design-system/components/sonner";
import { TooltipProvider } from "@repo/design-system/components/tooltip";
import { cn } from "@repo/design-system/lib/utils";
import { ThemeProvider } from "@/components/theme-provider";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });
const notoSansHeading = Noto_Sans({ subsets: ["latin"], variable: "--font-heading" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Cognitive Wealth",
  description: "Design system preview",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn(
        "font-sans antialiased",
        inter.variable,
        notoSansHeading.variable,
        geistMono.variable,
      )}
    >
      <body>
        <ThemeProvider>
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
