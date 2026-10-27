// History tables (ADR 0025): an update or delete of a row in a table `app` may change keeps the old
// version in `<table>_history`, written by the `record_history()` trigger with who made the change.
// Rows are set up and read as `migratorOrm`, the tables' owner, which row-level security doesn't
// hold; the change under test runs as `orm` (`app`) where the role matters.
import { eq, sql } from "drizzle-orm";
import { setActor } from "./actor";
import { withFirm } from "./firm";
import {
  custodialAccount,
  custodialAccountHistory,
  custodianDelivery,
  organization,
  security,
  securityHistory,
  user,
} from "./schema";
import { test } from "./testing";

const INSUFFICIENT_PRIVILEGE = { cause: { code: "42501" } };
const ACTOR_NOT_SET = {
  cause: { code: "42501", message: expect.stringMatching(/^Actor not set/) },
};

/** A Firm with one Account, one Security and one Delivery, written as the tables' owner. */
const firm = test.extend("firm", async ({ migratorOrm }) => {
  const [larkspur] = await migratorOrm
    .insert(organization)
    .values({ name: "Larkspur", slug: "larkspur" })
    .returning();
  const firmId = larkspur!.id;
  const [account] = await migratorOrm
    .insert(custodialAccount)
    .values({ firmId, accountNumber: "CW-000001", registrationType: "individual" })
    .returning();
  const [fund] = await migratorOrm
    .insert(security)
    .values({ firmId, identifier: "VTI", name: "Total Market", kind: "fund" })
    .returning();
  const [delivery] = await migratorOrm
    .insert(custodianDelivery)
    .values({ firmId, asOfDate: "2026-03-02", manifestSha256: "0".repeat(64) })
    .returning();
  return { id: firmId, account: account!, fund: fund!, deliveryId: delivery!.id };
});

describe("history", () => {
  firm(
    "keeps the old version of a row migrator updates, as migrator's",
    async ({ migratorOrm, firm: { fund } }) => {
      await migratorOrm
        .update(security)
        .set({ name: "Total Stock Market" })
        .where(eq(security.id, fund.id));

      expect(await migratorOrm.select().from(securityHistory)).toEqual([
        {
          id: expect.any(Number),
          recordId: fund.id,
          publicId: fund.publicId,
          firmId: fund.firmId,
          identifier: "VTI",
          name: "Total Market",
          kind: "fund",
          createdAt: fund.createdAt,
          updatedAt: fund.updatedAt,
          operation: "update",
          validUntil: expect.any(Date),
          changedByUserId: null,
          changedByDeliveryId: null,
          changedBySystem: "migrator",
        },
      ]);
    },
  );

  firm("keeps a deleted row's last version", async ({ migratorOrm, firm: { account } }) => {
    await migratorOrm.delete(custodialAccount).where(eq(custodialAccount.id, account.id));

    expect(
      await migratorOrm
        .select({
          recordId: custodialAccountHistory.recordId,
          accountNumber: custodialAccountHistory.accountNumber,
          operation: custodialAccountHistory.operation,
        })
        .from(custodialAccountHistory),
    ).toEqual([{ recordId: account.id, accountNumber: "CW-000001", operation: "delete" }]);
  });

  firm("records the actor app's transaction set", async ({ orm, migratorOrm, firm: f }) => {
    const [someone] = await migratorOrm
      .insert(user)
      .values({ email: "ada@larkspur.test", name: "Ada", emailVerified: true })
      .returning();

    await withFirm(orm, {
      firmId: f.id,
      query: async (tx) => {
        await setActor(tx, { deliveryId: f.deliveryId });
        await tx.update(security).set({ name: "Total Stock Market" });
        await setActor(tx, { userId: someone!.id });
        await tx.update(custodialAccount).set({ registrationType: "joint" });
        await setActor(tx, { system: "seed" });
        await tx.update(custodialAccount).set({ registrationType: "roth_ira" });
      },
    });

    const actors = (table: typeof securityHistory | typeof custodialAccountHistory) =>
      migratorOrm
        .select({
          userId: table.changedByUserId,
          deliveryId: table.changedByDeliveryId,
          system: table.changedBySystem,
        })
        .from(table)
        .orderBy(table.id);
    expect(await actors(securityHistory)).toEqual([
      { userId: null, deliveryId: f.deliveryId, system: null },
    ]);
    expect(await actors(custodialAccountHistory)).toEqual([
      { userId: someone!.id, deliveryId: null, system: null },
      { userId: null, deliveryId: null, system: "seed" },
    ]);
    expect(
      await migratorOrm
        .select({ registrationType: custodialAccountHistory.registrationType })
        .from(custodialAccountHistory)
        .orderBy(custodialAccountHistory.id),
    ).toEqual([{ registrationType: "individual" }, { registrationType: "joint" }]);
  });

  firm(
    "refuses app's change with no actor, and writes nothing",
    async ({ orm, migratorOrm, firm: f }) => {
      await expect(
        withFirm(orm, {
          firmId: f.id,
          query: (tx) => tx.update(security).set({ name: "Total Stock Market" }),
        }),
      ).rejects.toMatchObject(ACTOR_NOT_SET);

      expect(await migratorOrm.select({ name: security.name }).from(security)).toEqual([
        { name: "Total Market" },
      ]);
      expect(await migratorOrm.select().from(securityHistory)).toEqual([]);
    },
  );

  // So a forgotten `setActor` fails the first time its code runs, not the first time data changes.
  firm(
    "refuses app's update with no actor even when it changes nothing",
    async ({ orm, firm: f }) => {
      await expect(
        withFirm(orm, {
          firmId: f.id,
          query: (tx) => tx.update(security).set({ name: "Total Market" }),
        }),
      ).rejects.toMatchObject(ACTOR_NOT_SET);
    },
  );

  firm(
    "writes nothing for an update that changes nothing but updated_at",
    async ({ migratorOrm, firm: { fund } }) => {
      await migratorOrm
        .update(security)
        .set({ name: "Total Market", kind: "fund", updatedAt: sql`now()` })
        .where(eq(security.id, fund.id));
      await migratorOrm.update(security).set({ updatedAt: sql`now()` });

      expect(await migratorOrm.select().from(securityHistory)).toEqual([]);
    },
  );

  firm("writes nothing for an insert", async ({ migratorOrm, firm: f }) => {
    await migratorOrm
      .insert(security)
      .values({ firmId: f.id, identifier: "BND", name: "Total Bond", kind: "fund" });

    expect(await migratorOrm.select().from(securityHistory)).toEqual([]);
  });

  firm("shows app only its own Firm's history", async ({ orm, migratorOrm, firm: f }) => {
    const [globex] = await migratorOrm
      .insert(organization)
      .values({ name: "Globex", slug: "globex" })
      .returning();
    await migratorOrm
      .insert(security)
      .values({ firmId: globex!.id, identifier: "VTI", name: "Total Market", kind: "fund" });
    await migratorOrm.update(security).set({ name: "Renamed" });

    const firms = await withFirm(orm, {
      firmId: f.id,
      query: (tx) => tx.select({ firmId: securityHistory.firmId }).from(securityHistory),
    });

    expect(firms).toEqual([{ firmId: f.id }]);
  });

  describe.for(["security_history", "custodial_account_history"])("%s", (table) => {
    firm.for([
      ["insert", sql`insert into ${sql.identifier(table)} default values`],
      ["update", sql`update ${sql.identifier(table)} set changed_by_system = 'app'`],
      ["delete", sql`delete from ${sql.identifier(table)}`],
    ] as const)("refuses app's %s", async ([, statement], { orm, firm: f }) => {
      await expect(
        withFirm(orm, { firmId: f.id, query: (tx) => tx.execute(statement) }),
      ).rejects.toMatchObject(INSUFFICIENT_PRIVILEGE);
    });
  });

  firm.for([
    ["no actor", sql`null, null, null`],
    ["two actors", sql`null, ${1}, 'seed'`],
  ] as const)("refuses a history row with %s", async ([, actors], { migratorOrm, firm: f }) => {
    await expect(
      migratorOrm.execute(sql`
        insert into security_history (
          record_id, public_id, firm_id, identifier, name, kind, created_at, updated_at,
          operation, valid_until, changed_by_user_id, changed_by_delivery_id, changed_by_system
        )
        values (
          ${f.fund.id}, ${f.fund.publicId}, ${f.id}, 'VTI', 'Total Market', 'fund', now(), now(),
          'update', now(), ${actors}
        )
      `),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint_name: "security_history_one_actor_check" },
    });
  });
});
