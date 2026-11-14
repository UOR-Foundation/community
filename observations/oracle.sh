#!/usr/bin/env bash
# Install the GrimoireLab component set collect.py runs: the dependency set
# GrimoireLab 1.23.0's poetry.lock pins at the commit oracles/grimoirelab/
# oracle.lock.json records, hash-checked. A commit id is a content address:
# git re-derives it on fetch, and any other commit is refused.
#
#   observations/oracle.sh <work-dir>     prints the venv's python
#
# The Discord half adds the two components oracles/grimoirelab carries as
# overlays on the lock's pinned commits: Perceval's discord backend (one new
# module beside the installed Perceval 1.6.2, the edition the lock pins) and
# Chronicler with its Discord eventizer, installed with the two runtime
# packages its own poetry.lock pins (cloudevents, deprecation), hash-checked.
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

lock="$here/../oracles/grimoirelab/oracle.lock.json"
overlays="$here/../oracles/grimoirelab"
revision() { python3 - "$lock" "$1" <<'PY'
import json, sys
[a] = [a for a in json.load(open(sys.argv[1]))['authorities'] if a['canonical_id'] == sys.argv[2]]
print(a['source']['revision'])
PY
}
edition="$(python3 - "$lock" <<'PY'
import json, sys
[a] = [a for a in json.load(open(sys.argv[1]))['authorities'] if a['canonical_id'] == 'chaoss/grimoirelab-perceval']
print(a['edition'])
PY
)"
have="$("$venv/bin/python" -c 'from importlib.metadata import version; print(version("perceval"))')"
[ "$have" = "$edition" ] || { echo "Perceval $have is installed; the discord overlay is for $edition" >&2; exit 3; }
core="$("$venv/bin/python" -c 'import os, perceval.backends.core as c; print(os.path.dirname(c.__file__))')"
cp "$overlays/perceval-discord/perceval/backends/core/discord.py" "$core/discord.py"

chronicler="$work/chronicler"
ccommit="$(revision chaoss/grimoirelab-chronicler)"
if [ "$(git -C "$chronicler" rev-parse HEAD 2>/dev/null || true)" != "$ccommit" ]; then
  rm -rf "$chronicler" && git init -q "$chronicler"
  git -C "$chronicler" fetch -q --depth 1 https://github.com/chaoss/grimoirelab-chronicler "$ccommit"
  git -C "$chronicler" checkout -q --detach FETCH_HEAD
  [ "$(git -C "$chronicler" rev-parse HEAD)" = "$ccommit" ] || { echo "chronicler is not at $ccommit" >&2; exit 3; }
  (cd "$overlays/chronicler-discord" && find chronicler -type f | sort) | while read -r f; do
    [ ! -e "$chronicler/$f" ] || { echo "the overlay would replace upstream $f" >&2; exit 4; }
    mkdir -p "$chronicler/$(dirname "$f")" && cp "$overlays/chronicler-discord/$f" "$chronicler/$f"
  done
fi
(cd "$chronicler" && "$tools/bin/poetry" export -f requirements.txt -o "$work/chronicler-requirements.txt")
python3 - "$work/chronicler-requirements.txt" >"$work/chronicler-runtime.txt" <<'PY'
import re, sys
# Each requirement is one line plus its --hash continuation lines.
blocks = re.split(r'\n(?=\S)', open(sys.argv[1]).read())
print('\n'.join(b for b in blocks if re.match(r'(cloudevents|deprecation)==', b)))
PY
"$venv/bin/pip" -q install --disable-pip-version-check --no-deps --require-hashes -r "$work/chronicler-runtime.txt" >&2
# Chronicler is put on the path from the staged tree, so no unpinned build backend is fetched to install it.
"$venv/bin/python" -c 'import site; print(site.getsitepackages()[0])' | xargs -I{} sh -c "printf '%s\n' '$chronicler' >{}/chronicler.pth"
echo "$venv/bin/python"
