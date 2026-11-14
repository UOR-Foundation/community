#!/usr/bin/env bash
# Install the GrimoireLab component set collect.py runs: the dependency set
# GrimoireLab 1.23.0's poetry.lock pins at the commit oracles/grimoirelab/
# oracle.lock.json records, hash-checked. A commit id is a content address:
# git re-derives it on fetch, and any other commit is refused.
#
#   observations/oracle.sh <work-dir>     prints the venv's python
#
# mysqlclient builds against the system's MySQL client headers
# (libmysqlclient-dev and pkg-config on Ubuntu).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
work="${1:?usage: oracle.sh <work-dir>}"
commit="$(python3 - "$here/../oracles/grimoirelab/oracle.lock.json" <<'PY'
import json, sys
[a] = [a for a in json.load(open(sys.argv[1]))['authorities'] if a['canonical_id'] == 'chaoss/grimoirelab']
print(a['source']['revision'])
PY
)"
src="$work/grimoirelab"
if [ "$(git -C "$src" rev-parse HEAD 2>/dev/null || true)" != "$commit" ]; then
  rm -rf "$src" && git init -q "$src"
  git -C "$src" fetch -q --depth 1 https://github.com/chaoss/grimoirelab "$commit"
  git -C "$src" checkout -q --detach FETCH_HEAD
  [ "$(git -C "$src" rev-parse HEAD)" = "$commit" ] || { echo "chaoss/grimoirelab is not at $commit" >&2; exit 3; }
fi
tools="$work/tools"
[ -x "$tools/bin/python" ] || python3 -m venv "$tools"
"$tools/bin/pip" -q install --disable-pip-version-check poetry==2.5.1 poetry-plugin-export==1.10.1
(cd "$src" && "$tools/bin/poetry" export -f requirements.txt -o "$work/requirements.txt")
venv="$work/venv"
[ -x "$venv/bin/python" ] || python3 -m venv "$venv"
"$venv/bin/pip" -q install --disable-pip-version-check --require-hashes -r "$work/requirements.txt" >&2
echo "$venv/bin/python"
