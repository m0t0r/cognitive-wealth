---
name: pr-visual
description: Write or update a pull request whose body a reviewer reads visually first — pele diagrams and data charts built from the real diff, before/after screenshots, and perf numbers from verification. Use when opening or updating a PR.
---

# Visual PR

A PR body built **from** the diff: the reviewer sees the shape of the change (what moved, where, how big, and what it looks like and costs at runtime) before reading lines. It's a plain GitHub body, Markdown plus the HTML GitHub allows, with images. Its sections follow the `mattpocock-skills:pr` template (Summary, Evidence, Merge Danger), so load that skill for each section's rules; this skill adds the visuals, the data and the order.

Work in `.dev/pr-visual/<branch>/` (gitignored). Scripts are in this skill's `scripts/`.

## Grounding rule

Every chart, file tree, ER diagram and diff excerpt comes from the real diff or a real measurement, never from memory or estimates. You write only the prose: the objective, the decision, and how risky it is. Leave out any fact the diff doesn't contain, and label anything inferred as inferred. Reviewers trust a confident chart, so a wrong one is worse than none.

## 1. Verify first, then scope the work unit

1. If the change reaches `apps/web` (CLAUDE.md, "Verification"), it must have a PASS from the `verifier-web` skill in this session. If it doesn't, run that skill first; its screenshots and traces are this PR's evidence. If it doesn't reach `apps/web` (docs, tooling, a package the app doesn't render), skip verification and step 3, and say in Evidence what ran instead (tests, lint, rendered diagrams).
2. The scope is the whole branch against its base, including later fixes, tests, docs and skill changes, not only the last edit. Leave out unrelated dirty files.
3. Write an **inventory** before authoring. List each changed route, component, dialog or popover, role or access variant, empty, error or loading state, schema table, server action or endpoint, and package boundary. Each item ends up in a visual or is left out deliberately because it's tiny or invisible. That list is the step's completion criterion.

## 2. Facts and data charts

```sh
node .claude/skills/pr-visual/scripts/facts.mjs --out .dev/pr-visual/<branch>   # --base/--head default to merge-base..HEAD
```

This writes `facts.json` (totals, per-file change and lines, test cases added and removed per layer, commits) and one `.mmd` per chart that has something to show:

| Chart                | Shows                                                                                                       | Use when                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `mix` (sankey)       | lines by area → source code, test code, docs, config, migrations                                            | more than one area changed                                              |
| `churn` (treemap)    | lines by area and file, largest first; vendored `.agents/skills` left out, its line count in the root label | always, unless only vendored files changed; it's the change's footprint |
| `files` (treeView)   | every changed file with change kind and `+/−`                                                               | up to 60 files                                                          |
| `tests` (xychart)    | test cases added and removed per layer                                                                      | tests changed                                                           |
| `commits` (gitGraph) | the branch's commits                                                                                        | 3–25 commits, when their order tells a story                            |

## 3. Runtime evidence, before and after

Serve both sides with the verifier's isolated stack, each with its own fresh database:

```sh
.claude/skills/verifier-web/start-app.sh                 # after: working tree on :3100
.claude/skills/verifier-web/start-app.sh --ref <base>    # before: on :3101
```

- **Screenshots**: same persona, viewport, theme and state on both servers. For each user flow, capture the entry surface, the surface that opens or changes, and the resulting state; capture each role variant the change treats differently. Make full-page pairs equal height with the `before-and-after` skill's recipe. A purely additive surface gets an after-only "Preview".
- **Perf**: trace each touched route on both servers (verifier-web step 4), then write `perf.mmd`:

  ```text
  xychart
    title "LCP by route, ms: before, after (line = 2.5 s budget)"
    x-axis ["/", "/settings/members"]
    y-axis "ms" 0 --> 3000
    bar [180, 210]
    bar [124, 150]
    line [2500, 2500]
  ```

  Do the same for INP when the change has interactions. Add a table of the exact numbers under the chart.

- **Client JS**: gzip-summed bytes of `apps/web/.next/static/chunks/**/*.js` in each build (the base build lives in `.dev/worktrees/<sha>`). Report it when it moves by more than 1 kB.
- **Accessibility**: `agent-browser a11y` violation counts per touched route on both servers.

## 4. Diagrams of the change

Map each item in the inventory to the smallest visual that carries it, and pick the exact header from the `pele` skill (`--types`). Use 1–3 diagrams, each with a one-line caption saying what to look at:

| Change                            | Visual                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Schema or migration               | `erDiagram` of the changed tables only, with each changed column's comment `"added"`, `"removed"` or `"was <type>"`, read from the migration SQL |
| Server action, route or auth flow | `sequenceDiagram` from browser to app to services, with the changed calls in the order the code makes them                                       |
| UI or flow state machine          | `stateDiagram-v2` of the states and transitions the diff adds or changes                                                                         |
| Module or package boundaries      | `flowchart` with one subgraph per package, laid out in two dimensions, with before and after as two subgraphs when the boundary moved            |
| Who can do what                   | a Markdown table of roles against actions; a diagram adds nothing here                                                                           |
| Rendered UI                       | screenshots (step 3), never a diagram                                                                                                            |

## 5. Render and look

```sh
node .claude/skills/pr-visual/scripts/render.mjs .dev/pr-visual/<branch>
```

Every `.mmd` becomes `<name>.light.png` and `<name>.dark.png` (2x, from SVGs in the design system's colours). The PNGs are what the PR attaches, since GitHub's attachments don't take SVG. Read them and check for overlapping or truncated labels, an empty chart, or the wrong diagram type. Fix and re-render once; if it's still wrong, drop that chart. A chart wider than about 1600 px (`width` in the receipt) is unreadable at GitHub's column width: switch a flowchart to `TB` or cut labels.

## 6. Assemble the body

Use this order, and budgets that keep it reviewable. The title is at most 70 characters and the Summary prose 1–3 short paragraphs. Key changes has 3–8 entries, each excerpt 40 lines or fewer. Leave out boilerplate: no "this PR…" preamble, no repeated file counts (the charts show them).

````markdown
## Summary

<objective, the key decision, the risk: 1–3 short paragraphs, in GLOSSARY.md's terms>

<headline: the key after-screenshot, or the one diagram that explains the change>

## Evidence

<!-- before-and-after:start -->
<!-- before-and-after:end -->

<perf chart(s) + table of numbers · client JS · a11y counts>

## Shape of the change

<mix> <churn>
<tests> <commits>
<diagrams from step 4, each with its caption>

<details><summary>Changed files</summary>

<files>

</details>

## Key changes

<details><summary><code>packages/auth/src/tenant.ts</code>: <what changed and why, one line></summary>

```diff
<the load-bearing hunk>
```

- <annotation linking to the line: https://github.com/<repo>/pull/<n>/files#diff-<sha256 of path>R<line>>

</details>

## Merge Danger

**Door:** <one-way or two-way>
**Blast Radius:** <one word>
````

Embed every chart and diagram as both of its PNGs, by local path, so `gh --attach` can swap in the uploaded asset. GitHub shows the one that matches the reader's theme:

```markdown
![<what the chart shows, in words>](./churn.light.png#gh-light-mode-only)
![<what the chart shows, in words>](./churn.dark.png#gh-dark-mode-only)
```

Give each chart its own line and the full width. Write alt text that states the finding ("packages/auth carries 40% of the change, half of it tests") rather than "chart".

## 7. Publish

Creating or editing a PR publishes to GitHub, so confirm with the user first unless they asked for it.

Everything goes through `gh`; there's no asset branch.

1. `gh pr create --draft` (or `gh pr view <n>`) to get the number. It stays a draft only until step 8 passes, so nobody reviews a body whose images haven't uploaded yet.
2. Put the screenshots in the body by local path too, both themes like the charts (the `before-and-after` skill's formatter lays out pairs). Then publish from `.dev/pr-visual/<branch>/`, where the body's `./<file>` paths resolve:

   ```sh
   node ../../../.claude/skills/pr-visual/scripts/attach.mjs <n> body.md
   ```

   It uploads every `./<file>` the body names with `gh pr edit --attach`, and publishes the body with each path replaced by its `github.com/user-attachments` URL, theme fragments kept. Plain `gh --attach` alone rewrites only a bare `![alt](./file.png)`: with a `#gh-dark-mode-only` fragment or in an HTML `src`, it leaves the broken local path and appends the image at the end.

Never transcribe secrets into excerpts, captions or screenshots. Don't capture `.dev/auth/*` or other state files, Mailpit links or codes, or anything in `.secrets/`.

## 8. Inspect the published PR

Open the PR with agent-browser in light mode and in dark mode (`set media dark`). Check that every image loaded (`eval "[...document.images].filter(i => !i.naturalWidth).map(i => i.src)"` returns `[]`). Check that the visuals come before the implementation detail, and that each chart's numbers match `facts.json`. Allow one fix-and-republish pass.

Then mark it ready: `gh pr ready <n>`. A PR is never left as a draft once its body is published.

On later pushes, rerun steps 2–6 for the whole branch and republish with step 7: every chart and screenshot uploads again, and the new body replaces the old one.
