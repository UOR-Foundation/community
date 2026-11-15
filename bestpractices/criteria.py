#!/usr/bin/env python3
"""Read the OpenSSF Best Practices badge criteria from the badge project's own
repository at the commit bestpractices/sources.json pins, into
bestpractices/criteria.json.

criteria/criteria.yml gives every criterion of the passing ('0'), silver ('1')
and gold ('2') levels in its major and minor group, with its category
(MUST, SHOULD or SUGGESTED) and its flags; config/locales/en.yml gives its
description and details. Every criterion is kept, the future and obsolete ones
with their flags, so none is dropped. Nothing is defaulted that criteria.yml
does not default itself: its header says every flag is false when absent.

    python3 -I bestpractices/criteria.py <sources-dir> [--check]

<sources-dir> holds the badge repository checked out at the pinned commit, as
best-practices-badge (oracles/reproject.mjs fetches it there). The YAML is read with PyYAML's safe loader, pinned in bestpractices/requirements.txt.
"""
import hashlib
import json
import pathlib
import sys

import yaml

HERE = pathlib.Path(__file__).resolve().parent
LEVELS = {'0': 'passing', '1': 'silver', '2': 'gold'}
CATEGORIES = ('MUST', 'SHOULD', 'SUGGESTED')
# The keys criteria.yml's header declares, each false unless set.
FLAGS = ('future', 'obsolete', 'na_allowed', 'na_justification_required',
         'met_justification_required', 'met_url_required')


def main():
    if len(sys.argv) < 2:
        sys.stderr.write('usage: criteria.py <sources-dir> [--check]\n')
        sys.exit(64)
    root = pathlib.Path(sys.argv[1]) / json.loads((HERE / 'sources.json').read_text())['badge']['name']
    sources = json.loads((HERE / 'sources.json').read_text())
    badge = sources['badge']
    head = (root / '.git' / 'HEAD').read_text().strip()
    if head.startswith('ref:'):
        head = (root / '.git' / head[5:]).read_text().strip()
    if head != badge['commit']:
        raise SystemExit(f'the badge checkout is at {head}, not the pinned {badge["commit"]}')
    raw = {p: (root / p).read_bytes() for p in (badge['criteria'], badge['locale'])}
    criteria = yaml.safe_load(raw[badge['criteria']])
    locale = yaml.safe_load(raw[badge['locale']])['en']['criteria']

    def pairs(node):
        # !!omap loads as a list of (key, value) pairs; a plain mapping as a dict.
        return list(node.items()) if isinstance(node, dict) else list(node)

    out = []
    for level_key, majors in pairs(criteria):
        if level_key not in LEVELS:
            raise SystemExit(f'criteria.yml has the level {level_key!r}, which the register does not bind')
        for major, minors in pairs(majors):
            for minor, entries in pairs(minors):
                for cid, spec in pairs(entries):
                    spec = spec or {}
                    if spec.get('category') not in CATEGORIES:
                        raise SystemExit(f'{cid} has the category {spec.get("category")!r}')
                    unknown = set(spec) - {'category', *FLAGS, 'description', 'details', 'rationale', 'autofill',
                                           'met_placeholder', 'unmet_placeholder', 'na_placeholder',
                                           'met_suppress', 'unmet_suppress'}
                    if unknown:
                        raise SystemExit(f'{cid} has the undeclared keys {sorted(unknown)}')
                    text = locale.get(level_key, {}).get(cid, {})
                    if 'description' not in text:
                        raise SystemExit(f'{cid} has no description in {badge["locale"]}')
                    description = ' '.join(text['description'].split())
                    details = ' '.join(text.get('details', '').split())
                    out.append({
                        'id': cid,
                        'level': LEVELS[level_key],
                        'major': major,
                        'minor': minor,
                        'category': spec['category'],
                        **{f: bool(spec.get(f, False)) for f in FLAGS},
                        'description': description,
                        'descriptionSha256': hashlib.sha256(description.encode()).hexdigest(),
                        'details': details,
                    })
    keys = [(c['level'], c['id']) for c in out]
    if len(set(keys)) != len(keys):
        raise SystemExit('a criterion is repeated within its level')
    doc = {
        'spec': 'uor-community/bestpractices-criteria/1',
        'source': {
            'repository': badge['url'],
            'commit': badge['commit'],
            'files': [{'path': p, 'sha256': hashlib.sha256(b).hexdigest()} for p, b in raw.items()],
        },
        'parser': {'name': 'PyYAML', 'version': yaml.__version__, 'loader': 'SafeLoader'},
        'criteria': out,
    }
    text = json.dumps(doc, indent=2, ensure_ascii=False) + '\n'
    target = HERE / 'criteria.json'
    if '--check' in sys.argv[2:]:
        if not target.exists() or target.read_text() != text:
            sys.stderr.write('bestpractices/criteria.json is not the reading of the pinned criteria\n')
            sys.exit(1)
    else:
        target.write_text(text)
    counts = {lv: sum(1 for c in out if c['level'] == lv) for lv in LEVELS.values()}
    sys.stdout.write(f'{len(out)} criteria: {counts}\n')


main()
