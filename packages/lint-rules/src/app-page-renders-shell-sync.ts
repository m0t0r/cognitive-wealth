import type { Rule } from "./max-inline-param-type-members.ts";

// A page under `apps/web/app/(app)/`. The rule checks the path itself, so `.oxlintrc.json` can
// turn it on everywhere without a glob that has to escape `(app)`.
const APP_PAGE = /[\\/]app[\\/]\(app\)[\\/](?:.+[\\/])?page\.tsx$/;

// Layouts don't re-render on client navigation, so a page whose request moved the viewer's
// session (a Removal or a deactivation) would show the new workspace under the old header, with no
// notice. `AppShellSync` refreshes the layout then (docs/auth.md, "Client navigation"); a page
// that renders without it brings that back with nothing else failing.
const rule: Rule = {
  meta: {
    type: "problem",
    docs: { description: "Every app page that renders something renders <AppShellSync />." },
    schema: [],
  },
  create(context) {
    if (!APP_PAGE.test(context.filename)) return {};
    let renders = false;
    let syncs = false;
    return {
      JSXElement() {
        renders = true;
      },
      JSXFragment() {
        renders = true;
      },
      JSXOpeningElement(element) {
        if (element.name.type === "JSXIdentifier" && element.name.name === "AppShellSync") {
          syncs = true;
        }
      },
      "Program:exit"(program) {
        // A page that only redirects renders nothing, and has no layout to keep up to date.
        if (!renders || syncs) return;
        context.report({
          node: program,
          message:
            'An app page renders <AppShellSync />, so the layout catches up when this page\'s request moved the session (docs/auth.md, "Client navigation").',
        });
      },
    };
  },
};

export default rule;
