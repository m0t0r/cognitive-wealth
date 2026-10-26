import { RuleTester } from "oxlint/plugins-dev";
import rule from "./app-page-renders-shell-sync.ts";

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "tsx" } } });

const APP_PAGE = "/repo/apps/web/app/(app)/households/page.tsx";
const missing = {
  message:
    'An app page renders <AppShellSync />, so the layout catches up when this page\'s request moved the session (docs/auth.md, "Client navigation").',
};

tester.run("app-page-renders-shell-sync", rule, {
  valid: [
    {
      name: "an app page that renders it",
      filename: APP_PAGE,
      code: "export default function Page() { return <div><AppShellSync /><h1>Households</h1></div>; }",
    },
    {
      name: "an app page that only redirects, rendering nothing",
      filename: "/repo/apps/web/app/(app)/settings/page.tsx",
      code: 'export default function Page() { redirect("/settings/members"); }',
    },
    {
      name: "a page outside the app shell",
      filename: "/repo/apps/web/app/(auth)/no-workspace/page.tsx",
      code: "export default function Page() { return <h1>No workspace</h1>; }",
    },
    {
      name: "the app layout, which isn't a page",
      filename: "/repo/apps/web/app/(app)/layout.tsx",
      code: "export default function Layout({ children }) { return <main>{children}</main>; }",
    },
    {
      name: "a component beside an app page",
      filename: "/repo/apps/web/app/(app)/households/households-table.tsx",
      code: "export function HouseholdsTable() { return <table />; }",
    },
  ],
  invalid: [
    {
      name: "an app page that renders without it",
      filename: APP_PAGE,
      code: "export default function Page() { return <h1>Households</h1>; }",
      errors: [missing],
    },
    {
      name: "a nested app page with a fragment",
      filename: "/repo/apps/web/app/(app)/households/[publicId]/page.tsx",
      code: "export default function Page() { return <><h1>Household</h1></>; }",
      errors: [missing],
    },
    {
      name: "a component of another name",
      filename: APP_PAGE,
      code: "export default function Page() { return <div><ShellSync /></div>; }",
      errors: [missing],
    },
  ],
});
