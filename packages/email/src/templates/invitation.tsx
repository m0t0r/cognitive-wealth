import { Button, Heading, Hr, Link, Section, Text } from "react-email";
import {
  BRAND,
  INVITATION_IGNORE_NOTICE,
  formatExpiry,
  invitationHeadline,
  invitationSummary,
  singleLine,
} from "../copy";
import { Layout, styles } from "./components/layout";

export interface InvitationEmailProps {
  /** Where the recipient accepts the invitation. */
  url: string;
  organizationName: string;
  /** The inviter's display name; blank or missing reads "You've been invited". */
  inviterName?: string | null;
  /** `owner`, `admin` or `member` (other values are shown as is). */
  role: string;
  expiresAt: Date | string | number;
}

export function invitationSubject(organizationName: string): string {
  return `You're invited to join ${singleLine(organizationName)} on ${BRAND}`;
}

export function InvitationEmail(props: InvitationEmailProps) {
  const { url, organizationName, expiresAt } = props;
  return (
    <Layout title={invitationSubject(organizationName)} preview={invitationSummary(props)}>
      <Heading as="h1" style={styles.heading}>
        {invitationHeadline(organizationName)}
      </Heading>
      <Text style={styles.text}>{invitationSummary(props)}</Text>
      <Section style={styles.buttonRow}>
        <Button href={url} style={styles.button}>
          Accept invitation
        </Button>
      </Section>
      <Text style={styles.text}>This invitation expires on {formatExpiry(expiresAt)}.</Text>
      <Hr style={styles.divider} />
      <Text style={styles.small}>
        If the button doesn&apos;t work, paste this link into your browser:{" "}
        <Link href={url} style={styles.link}>
          {url}
        </Link>
      </Text>
      <Text style={{ ...styles.small, margin: 0 }}>{INVITATION_IGNORE_NOTICE}</Text>
    </Layout>
  );
}

InvitationEmail.PreviewProps = {
  url: "https://cognitive-wealth.localhost/invitations/0192f5a4-7c1e-7d3a-9b2f-3c4d5e6f7a8b",
  organizationName: "Acme",
  inviterName: "Olivia Owner",
  role: "member",
  expiresAt: "2026-10-29T15:00:00.000Z",
} satisfies InvitationEmailProps;

export default InvitationEmail;
