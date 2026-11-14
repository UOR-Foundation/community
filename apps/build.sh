#!/usr/bin/env bash
# Regenerate the community's decision apps, in the order each step reads the
# last one's output:
#
#   1. apps/indicators.mjs: one indicator prompt per CHAOSS metrics model in
#      chaoss/register.json, and apps/set.json listing every prompt in apps/;
#   2. the Prism-DevRel builder's build-set, at the commit apps/set.json pins:
#      every app's module pair, the router, the facet modules, the claim rows,
#      scenarios and tests (docs/decisions/0001-one-app-many-decisions.md);
#   3. lexlean fmt and lexlean lock, the canonical form the gate checks;
#   4. check-model --write, which regenerates CONFORMANCE.md.
#
# Steps 3 and 4 need the SDK image prismpm.lock pins. With --check, nothing is
# written and the script fails if a committed file is not what the prompts and
# the register generate.
#
#   apps/build.sh [--check]
#
# PRISM_BUILDER names a builder/cli.mjs to use instead of the pinned commit.
set -euo pipefail
cd "$(dirname "$0")/.."
check=${1:-}
repo=$(node -p 'require("./apps/set.json").builder.repository')
commit=$(node -p 'require("./apps/set.json").builder.commit')
builder=${PRISM_BUILDER:-}
if [ -z "$builder" ]; then
  # The builder is addressed by its commit, so a checkout of it is reused as is.
  dir=${XDG_CACHE_HOME:-$HOME/.cache}/prism-devrel/$commit
  if [ ! -f "$dir/builder/cli.mjs" ]; then
    rm -rf "$dir" && mkdir -p "$dir"
    git -C "$dir" init -q
    git -C "$dir" fetch -q --depth 1 "https://github.com/$repo" "$commit"
    git -C "$dir" checkout -q FETCH_HEAD
  fi
  [ "$(git -C "$dir" rev-parse HEAD)" = "$commit" ] || { echo "builder checkout is not $commit" >&2; exit 1; }
  builder=$dir/builder/cli.mjs
fi
if [ "$check" = --check ]; then
  node apps/indicators.mjs --check
  node "$builder" build-set apps/set.json --out . --check
  exit 0
fi
node apps/indicators.mjs
node "$builder" build-set apps/set.json --out .
(cd app && lexlean lock && lexlean fmt && lexlean lock)
cargo run -q --locked -p xtask -- check-model --write
