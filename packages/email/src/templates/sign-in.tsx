import { Button, Heading, Hr, Link, Section, Text } from "react-email";
import type { CSSProperties } from "react";
import { BRAND, SIGN_IN_IGNORE_NOTICE, minutes, signInExpiryNotice } from "../copy";
import { colors, fonts, Layout, styles } from "./components/layout";

export interface SignInEmailProps {
  /** The confirm URL (`…/sign-in/confirm#token=…`). */
  url: string;
  /** The 6-digit one-time code. */
  code: string;
  expiresInMinutes: number;
}

export const SIGN_IN_SUBJECT = `Your ${BRAND} sign-in link`;

const codeStyle: CSSProperties = {
  margin: "0 0 24px",
  padding: "16px",
  borderRadius: "8px",
  backgroundColor: colors.page,
  color: colors.text,
  fontFamily: fonts.mono,
  fontSize: "32px",
  fontWeight: 700,
  letterSpacing: "8px",
  lineHeight: "40px",
  textAlign: "center",
};

export function SignInEmail({ url, code, expiresInMinutes }: SignInEmailProps) {
  return (
    <Layout
      title={SIGN_IN_SUBJECT}
      preview={`Use this link or code to sign in. It expires in ${minutes(expiresInMinutes)}.`}
    >
      <Heading as="h1" style={styles.heading}>
        Sign in to {BRAND}
      </Heading>
      <Text style={styles.text}>Use the button below to sign in to your account.</Text>
      <Section style={styles.buttonRow}>
        <Button href={url} style={styles.button}>
          Sign in to {BRAND}
        </Button>
      </Section>
      <Text style={styles.text}>Or enter this code on the sign-in page:</Text>
      <Text style={codeStyle}>{code}</Text>
      <Text style={styles.text}>{signInExpiryNotice(expiresInMinutes)}</Text>
      <Hr style={styles.divider} />
      <Text style={styles.small}>
        If the button doesn&apos;t work, paste this link into your browser:{" "}
        <Link href={url} style={styles.link}>
          {url}
        </Link>
      </Text>
      <Text style={{ ...styles.small, margin: 0 }}>{SIGN_IN_IGNORE_NOTICE}</Text>
    </Layout>
  );
}

SignInEmail.PreviewProps = {
  url: "https://cognitive-wealth.localhost/sign-in/confirm#token=preview-token&next=%2F",
  code: "482193",
  expiresInMinutes: 5,
} satisfies SignInEmailProps;

export default SignInEmail;
