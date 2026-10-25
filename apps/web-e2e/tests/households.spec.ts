import { expect, test } from "../fixtures";
import { recordCspViolations } from "../support/csp";
import { seedIngestedWorld } from "../support/households";
import { seedUser, uniqueEmail } from "../support/seed";

// What the overview holds, and that another Firm's Household is unknown, is owned by
// packages/households/src/overview.integration.test.ts, and the number formats by
// apps/web/lib/format.test.ts. Here: the page an Advisor reaches after a real seed and Ingestion,
// and its 404s through the real stack.

test("an Advisor opens the Household from home and reads its Positions as of the latest As-of date", async ({
  page,
  db,
  signIn,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "advisor");
  const user = await seedUser(db, { email, name: "Ada Advisor" });
  const publicId = await seedIngestedWorld(db, {
    advisor: { user, firm: "larkspur", role: "member" },
  });
  const violations = await recordCspViolations(page);
  await signIn(email);

  await page.goto("/");
  await page.getByRole("link", { name: "The Reyes Household" }).click();

  await expect(page).toHaveURL(`/households/${publicId}`);
  await expect(page).toHaveTitle(/^The Reyes Household/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("The Reyes Household");
  await expect(page.getByText("Client", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Positions as of Mar 6, 2026, as reported by the custodian."),
  ).toBeVisible();

  const people = page.getByRole("region", { name: "People" }).getByRole("listitem");
  await expect(people).toHaveText([/Dana Reyes\s*Primary/, /Jordan Reyes\s*Co-client/]);

  // 6 March's Positions, as the Custodian's positions.csv has them, never 2 March's.
  const joint = page.getByRole("table", { name: "Joint ending in 0001" });
  await expect(joint.getByRole("row")).toHaveText([
    /Security\s*Shares\s*Price\s*Market value/,
    /Larkspur Bond Fund\s*LKBF\s*300\s*\$10\.02\s*\$3,006\.00/,
    /Larkspur Stock Fund\s*LKSF\s*30\s*\$153\.40\s*\$4,602\.00/,
    /Larkspur Bank Sweep\s*SWEEP\s*6,476\.65\s*\$1\.00\s*\$6,476\.65/,
  ]);
  const ira = page.getByRole("table", { name: "Traditional IRA ending in 0002" });
  await expect(ira.getByRole("row")).toHaveText([
    /Security\s*Shares\s*Price\s*Market value/,
    /Larkspur Stock Fund\s*LKSF\s*20\s*\$153\.40\s*\$3,068\.00/,
    /Larkspur Bank Sweep\s*SWEEP\s*2,995\s*\$1\.00\s*\$2,995\.00/,
  ]);
  await expect(page.getByText("Dana Reyes, Owner · Jordan Reyes, Beneficiary")).toBeVisible();

  // The account numbers stay on the server, masked to their last four.
  expect(await page.content()).not.toContain("CW-00000");
  expect(violations).toEqual([]);
});

test("another Firm's Household and an unknown one are both not found", async ({
  page,
  db,
  signIn,
}, testInfo) => {
  const email = uniqueEmail(testInfo, "globex");
  const user = await seedUser(db, { email, name: "Gil Globex" });
  // The Household is Larkspur's; this Advisor is only in Globex.
  const larkspurs = await seedIngestedWorld(db, {
    advisor: { user, firm: "globex", role: "owner" },
  });
  await signIn(email);

  for (const publicId of [larkspurs, "01900000-0000-7000-8000-000000000000", "not-a-uuid"]) {
    // oxlint-disable-next-line no-await-in-loop -- one page, one navigation at a time
    const response = await page.goto(`/households/${publicId}`);
    expect(response?.status(), publicId).toBe(404);
    // oxlint-disable-next-line no-await-in-loop -- as above
    await expect(page.getByText("The Reyes Household")).toHaveCount(0);
  }
});
