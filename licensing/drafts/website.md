# REUSE remediation draft: website

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/website at `e82ffdedc5d85ebd0bde239d50d4651005045d31`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 188 files, 10 with copyright, 0 with licensing information; compliant: false

## License expression

Undetermined.

## LICENSES/

No change.

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 178 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='<COPYRIGHT HOLDER>' --license='<EXPRESSION>' --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 10 files with a copyright notice but no licensing information

```sh
reuse annotate --license='<EXPRESSION>' --fallback-dot-license -- .lovable/plan/about-page-and-footer-link-2026-10-22.md .lovable/plan/lean-self-contained-one-page-site-2026-10-22.md public/blog/lexlean-v0-4/mnist-demo.html src/about/About.tsx src/agent/Agents.tsx src/agent/DiscordPosting.tsx src/blog/Blog.tsx src/framework/Framework.tsx src/playground/Playground.tsx src/site/FoundationHome.tsx
```

## Check

```sh
reuse lint
```

## Open

- The license expression is not determined by the repository: its manifests and LICENSE texts are absent, unidentified or disagree (see the open claims in licensing/register.json). `<EXPRESSION>` stands for it until it is decided.
- No LICENSE file names a copyright holder. `<COPYRIGHT HOLDER>` stands for the holder until the Foundation names it.
