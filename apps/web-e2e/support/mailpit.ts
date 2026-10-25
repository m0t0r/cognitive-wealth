import { GenericContainer, Wait } from "testcontainers";
import { composeImage } from "@repo/testing/compose";

const UI_USER = "e2e";

/**
 * Starts Mailpit as compose.yaml does (same image, non-root, mail in a tmpfs). Testcontainers
 * publishes ports on every host interface, so the UI and API, which hold sign-in links, require
 * random Basic auth credentials; SMTP stays open, as the server's mailer expects.
 */
export async function startMailpit(uiPassword: string) {
  const container = await new GenericContainer(composeImage("axllent/mailpit"))
    .withUser("65534:65534")
    .withEnvironment({
      MP_DISABLE_VERSION_CHECK: "true",
      MP_SMTP_DISABLE_RDNS: "true",
      MP_UI_AUTH_FILE: "/run/secrets/mailpit_ui_auth",
    })
    .withCopyContentToContainer([
      {
        content: `${UI_USER}:${uiPassword}\n`,
        target: "/run/secrets/mailpit_ui_auth",
        mode: 0o444,
      },
    ])
    .withTmpFs({ "/tmp": "rw,mode=1777" })
    .withExposedPorts(1025, 8025)
    .withWaitStrategy(Wait.forHttp("/readyz", 8025))
    .start();

  const host = container.getHost();
  const api = new URL(`http://${host}:${container.getMappedPort(8025)}`);
  api.username = UI_USER;
  api.password = uiPassword;
  return {
    smtpUrl: `smtp://${host}:${container.getMappedPort(1025)}`,
    /** With the credentials as userinfo, which `createMailpit` turns into Basic auth. */
    apiUrl: api.toString(),
    stop: () => container.stop(),
  };
}
