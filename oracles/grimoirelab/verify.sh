#!/usr/bin/env bash
# Verify the GrimoireLab oracle by running upstream's own test suites at the
# commits oracle.lock.json pins. A commit id is a content address: git
# re-derives it on fetch, and a mismatch is refused.
#
#   oracles/grimoirelab/verify.sh perceval   [work-dir]
#   oracles/grimoirelab/verify.sh sortinghat [work-dir]
#   oracles/grimoirelab/verify.sh chronicler [work-dir]
#
# perceval:   overlay the Discord backend (new files only; replacing an
#             upstream file is refused), install the dependency set upstream's
#             poetry.lock pins with hashes required, then run flake8 and
#             upstream's tests/run_tests.py with no proxy, so a test that
#             reaches the network fails instead of hanging.
# sortinghat: install the same way and run upstream CI's flake8 and its two
#             Django test commands; its runner starts the MariaDB image
#             upstream names (TEST_DATABASE_IMAGE) through testcontainers, so
#             Docker is needed.
# chronicler: overlay the Discord eventizer the same way as perceval (new
#             files only), install the same way, then run the commands
#             upstream's tests.yml runs: ruff check, ruff format --diff, and
#             tests/run_tests.py under coverage. requirements_dev.txt is not
#             installed: it is an unpinned Git checkout of grimoirelab-toolkit
#             that --require-hashes cannot admit, and the toolkit release
#             poetry.lock pins is installed instead.
#
# safe.directory is set for the run only, in a global config file of its own
# (git honors it only from global or system scope): upstream's git fixtures are tarballs
# whose owner differs from the user when run as root, and git then refuses
# them. It changes no test and no fixture.
set -euo pipefail

component="${1:?usage: verify.sh perceval|sortinghat|chronicler [work-dir]}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
lock="$here/oracle.lock.json"
work="${2:-$(mktemp -d)}/$component"
mkdir -p "$work"
python="${PYTHON:-python3}"

authority() {
  python3 - "$lock" "$1" "$2" <<'PY'
import json, sys
lock, canonical, field = sys.argv[1:]
[a] = [a for a in json.load(open(lock))['authorities'] if a['canonical_id'] == canonical]
print(a['source'][field])
PY
}

case "$component" in
  perceval) canonical=chaoss/grimoirelab-perceval ;;
  sortinghat) canonical=chaoss/grimoirelab-sortinghat ;;
  chronicler) canonical=chaoss/grimoirelab-chronicler ;;
  *) echo "unknown component $component" >&2; exit 64 ;;
esac
commit="$(authority "$canonical" revision)"

src="$work/src"
rm -rf "$src" && git init -q "$src"
git -C "$src" fetch -q --depth 1 "https://github.com/$canonical" "$commit"
git -C "$src" checkout -q --detach FETCH_HEAD
got="$(git -C "$src" rev-parse HEAD)"
if [ "$got" != "$commit" ]; then
  echo "$canonical is at $got, the lock pins $commit" >&2
  exit 3
fi

overlay_dirs=()
case "$component" in
  perceval) overlay="$here/perceval-discord" overlay_dirs=(perceval tests releases) ;;
  chronicler) overlay="$here/chronicler-discord" overlay_dirs=(chronicler tests releases) ;;
esac
if [ "${#overlay_dirs[@]}" -gt 0 ]; then
  (cd "$overlay" && find "${overlay_dirs[@]}" -type f | sort) | while read -r f; do
    if [ -e "$src/$f" ]; then
      echo "overlay would replace upstream $f" >&2
      exit 4
    fi
    mkdir -p "$src/$(dirname "$f")"
    cp "$overlay/$f" "$src/$f"
  done
  # Edits to existing upstream files (documentation, the help text) travel as
  # one patch, so the change to upstream code stays visible and reviewable
  # and a patch that no longer applies to the pinned commit is refused.
  if [ -f "$overlay/upstream.patch" ]; then
    if ! git -C "$src" apply --check "$overlay/upstream.patch"; then
      echo "upstream.patch does not apply to $commit" >&2
      exit 5
    fi
    git -C "$src" apply "$overlay/upstream.patch"
  fi
fi

venv="$work/venv"
[ -x "$venv/bin/python" ] || "$python" -m venv "$venv"
pip() { "$venv/bin/pip" -q install --disable-pip-version-check "$@"; }
pip poetry==2.5.1 poetry-plugin-export==1.10.1
(cd "$src" && "$venv/bin/poetry" export --with dev -f requirements.txt -o "$work/requirements.txt")
pip --require-hashes -r "$work/requirements.txt"
pip --no-deps -e "$src"

printf '[safe]\n\tdirectory = *\n' >"$work/gitconfig"
export GIT_CONFIG_GLOBAL="$work/gitconfig"
offline=(env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u ALL_PROXY -u all_proxy NO_PROXY='*')

cd "$src"
if [ "$component" = perceval ]; then
  "$venv/bin/flake8" perceval/backends/core/discord.py tests/test_discord.py
  cd tests
  "${offline[@]}" "$venv/bin/python" run_tests.py
elif [ "$component" = chronicler ]; then
  "${offline[@]}" "$venv/bin/ruff" check
  "${offline[@]}" "$venv/bin/ruff" format --diff
  cd tests
  "${offline[@]}" "$venv/bin/coverage" run --source=chronicler run_tests.py
else
  "$venv/bin/flake8"
  "${offline[@]}" "$venv/bin/python" manage.py test --settings=config.settings.config_testing
  "${offline[@]}" "$venv/bin/python" manage.py test --settings=config.settings.config_testing_tenant
fi
