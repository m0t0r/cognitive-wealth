import { Body, Container, Head, Html, Preview, Section, Text } from "react-email";
import type { CSSProperties, ReactNode } from "react";
import { BRAND } from "../../copy";

/**
 * The design system's light theme as hex: email clients don't support CSS variables or
 * oklch() reliably. Every text colour passes WCAG AA on both `page` and `card`.
 */
export const colors = {
  page: "#f4f4f5", // --muted
  card: "#ffffff", // --background
  border: "#e4e4e7", // --border
  text: "#09090b", // --foreground (19.9:1 on card)
  muted: "#52525b", // zinc-600, darker than --muted-foreground so it passes on `page` (7:1)
  primary: "#0069a8", // --primary (5.9:1 on card)
  primaryText: "#f0f9ff", // --primary-foreground (5.5:1 on primary)
} as const;

// Webfonts are unreliable in email, so Inter and Noto Sans are named first and fall back
// to each platform's system UI font.
const systemStack =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const fonts = {
  body: `Inter, ${systemStack}`,
  heading: `"Noto Sans", Inter, ${systemStack}`,
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
} as const;

export const styles = {
  heading: {
    margin: "0 0 16px",
    color: colors.text,
    fontFamily: fonts.heading,
    fontSize: "22px",
    fontWeight: 600,
    lineHeight: "30px",
  },
  text: {
    margin: "0 0 16px",
    color: colors.text,
    fontSize: "16px",
    lineHeight: "24px",
  },
  small: {
    margin: "0 0 12px",
    color: colors.muted,
    fontSize: "14px",
    lineHeight: "20px",
  },
  button: {
    display: "inline-block",
    padding: "12px 20px",
    borderRadius: "8px",
    backgroundColor: colors.primary,
    color: colors.primaryText,
    fontSize: "16px",
    fontWeight: 600,
    lineHeight: "24px",
    textDecoration: "none",
  },
  buttonRow: { margin: "8px 0 24px" },
  link: { color: colors.primary, textDecoration: "underline", wordBreak: "break-all" },
  divider: { margin: "24px 0", border: "none", borderTop: `1px solid ${colors.border}` },
} satisfies Record<string, CSSProperties>;

const body: CSSProperties = {
  margin: 0,
  padding: "32px 0",
  backgroundColor: colors.page,
  color: colors.text,
  fontFamily: fonts.body,
};

const container: CSSProperties = { maxWidth: "560px", padding: "0 16px" };

const brand: CSSProperties = {
  margin: "0 0 16px",
  color: colors.text,
  fontFamily: fonts.heading,
  fontSize: "18px",
  fontWeight: 700,
  lineHeight: "24px",
};

const card: CSSProperties = {
  padding: "32px",
  border: `1px solid ${colors.border}`,
  borderRadius: "10px",
  backgroundColor: colors.card,
};

const footer: CSSProperties = {
  margin: "16px 0 0",
  color: colors.muted,
  fontSize: "12px",
  lineHeight: "18px",
  textAlign: "center",
};

export interface LayoutProps {
  /** Document title, usually the subject. */
  title: string;
  /** Inbox preview text, shown after the subject in most clients. */
  preview: string;
  children: ReactNode;
}

export function Layout({ title, preview, children }: LayoutProps) {
  return (
    <Html lang="en" dir="ltr">
      <Head>
        <title>{title}</title>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
      </Head>
      <Body style={body}>
        <Preview>{preview}</Preview>
        <Container style={container}>
          <Text style={brand}>{BRAND}</Text>
          <Section style={card}>{children}</Section>
          <Text style={footer}>
            This is an automated message from {BRAND}. Replies to this address aren&apos;t read.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
