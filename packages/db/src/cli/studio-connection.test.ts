import { studioConnection } from "./studio-connection";

const APP_FILE = "/repo/.secrets/db_app_password";

describe("studioConnection", () => {
  it("signs in to a local database as migrator, with the password file beside app's", () => {
    expect(
      studioConnection({
        DATABASE_URL: "postgres://app@localhost:5433/wt_task_0ebb429f",
        DATABASE_PASSWORD_FILE: APP_FILE,
      }),
    ).toEqual({
      url: "postgres://migrator@localhost:5433/wt_task_0ebb429f",
      passwordFile: "/repo/.secrets/db_migrator_password",
      role: "migrator",
    });
  });

  it.for([
    {
      why: "a remote host",
      env: { DATABASE_URL: "postgres://app@db.example.com/cw", DATABASE_PASSWORD_FILE: APP_FILE },
    },
    {
      why: "NODE_ENV=production",
      env: {
        DATABASE_URL: "postgres://app@localhost/cw",
        DATABASE_PASSWORD_FILE: APP_FILE,
        NODE_ENV: "production",
      },
    },
    { why: "no password file", env: { DATABASE_URL: "postgres://app:pw@localhost/cw" } },
  ])("keeps the URL's own role for $why", ({ env }) => {
    expect(studioConnection(env)).toEqual({
      url: env.DATABASE_URL,
      passwordFile: env.DATABASE_PASSWORD_FILE,
      role: "app",
    });
  });
});
