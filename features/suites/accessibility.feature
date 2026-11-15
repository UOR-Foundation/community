Feature: accessibility

  The accessibility register: every public page of the Foundation's web properties (the
  website's sitemap, checked against the routes of its src/App.tsx, and the pages each
  other deployed service of inventory/register.json links under its URL), read in the light
  and dark color schemes at the desktop and phone widths by Deque axe-core in Chromium
  (accessibility/snapshot.mjs), each axe rule mapped to the WCAG 2.2 success criteria its
  own tags name and every criterion given one outcome per page by accessibility/project.mjs,
  EN 301 549 V3.2.1 clause 9 mapped to WCAG 2.1, and declared as Foundation.Accessibility.V1
  records in app/src/Accessibility.lex.tex.

  @AX-01 @build
  Scenario: The accessibility register is valid: every page of the Foundation's public web content has one reading in each configuration and exactly one outcome for every WCAG 2.2 Level A and AA success criterion, each outcome agrees with what the axe-core rules mapped to the criterion did on the page, a criterion is passed only when a mapped rule ran and passed with none failed or incomplete, every outcome that is not a pass is named by an open claim, and EN 301 549 clause 9 requires every WCAG 2.1 Level A and AA criterion exactly once
    Given the catalog in app/src/Accessibility.lex.tex
    When the Lean kernel checks registerValidHolds in the Accessibility catalog during prismpm verify
    Then registerValid holds of the release, its criteria, requirements, rules, pages, readings, outcomes, open claims, refusals, clauses and exclusions

  @AX-02 @build
  Scenario: The accessibility catalog declares every success criterion, axe rule, page, reading and outcome of accessibility/register.json, each reading's URL, fetch time and document digest, the axe-core version and lock integrity, the browser and Playwright versions, and the digests of the WCAG source, the website routes, the sitemap, the EN 301 549 text and the snapshot it was projected from
    Given accessibility/register.json projected from the pinned sources and accessibility/snapshot.json
    When the catalog is read
    Then every criterion, rule, page, reading and outcome is declared, with every digest, fetch time and tool version

  @AX-03 @open
  Scenario: A WCAG 2.2 Level A or AA success criterion that axe-core fails, cannot decide, does not test or finds nothing to test on a page, a conformance requirement no automated rule observes, and a page or EN 301 549 clause the sources cannot settle are carried as open claims, never restated as conformance
    Given the outcomes, open claims and refusals in accessibility/register.json
    When the catalog is read
    Then every outcome that is not a pass is one OpenClaim of its kind, and the release counts every outcome by kind
