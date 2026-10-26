// One representative run of `cw org deactivate` and `reactivate` on a real database, as `app`:
// the dry run, the change, the refusal, the undo. `@repo/db`'s org-status tests own the rules.
import { eq } from "drizzle-orm";
import { createOrganization } from "@repo/db/cli/organizations";
import { organization } from "@repo/db/schema";
import { test } from "@repo/db/testing";
import { createCli } from "../app";
import { dependencies, run } from "../testing";

const args = (command: string, ...rest: string[]) => [
  "org",
  command,
  "--slug",
  "acme",
  "--reason",
  "Contract ended",
  ...rest,
];

test("deactivates after a dry run, refuses twice, and reactivates", async ({ orm }) => {
  const created = await createOrganization(orm, {
    name: "Acme",
    slug: "acme",
    ownerEmail: "owner@acme.test",
  });
  const cli = createCli(
    dependencies({
      openDatabase: async () => ({ db: orm, close: async () => {}, target: "test" }),
    }),
  );
  const deactivatedAt = async () =>
    (
      await orm
        .select({ at: organization.deactivatedAt })
        .from(organization)
        .where(eq(organization.slug, "acme"))
    )[0]?.at;

  const dryRun = await run({ cli, argv: args("deactivate", "--dry-run") });
  expect(dryRun).toMatchObject({
    exitCode: 0,
    output: {
      database: "test",
      publicId: created.publicId,
      slug: "acme",
      dryRun: true,
      cta: {
        commands: [{ command: "pnpm cw org deactivate --slug acme --reason 'Contract ended'" }],
      },
    },
  });
  expect(await deactivatedAt()).toBeNull();

  const deactivated = await run({ cli, argv: args("deactivate") });
  expect(deactivated.output).toMatchObject({ dryRun: false, canceledInvitations: 0 });
  expect(await deactivatedAt()).toEqual(new Date(String(deactivated.output.at)));

  const again = await run({ cli, argv: args("deactivate") });
  expect(again).toMatchObject({ exitCode: 1, output: { code: "already_deactivated" } });

  const reactivated = await run({ cli, argv: args("reactivate") });
  expect(reactivated).toMatchObject({ exitCode: 0, output: { dryRun: false } });
  expect(await deactivatedAt()).toBeNull();
});
