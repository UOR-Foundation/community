# REUSE remediation draft: uor-r4

Data only. Nothing here has been applied to the repository, and no issue or pull request has been opened.

- Repository: https://github.com/UOR-Foundation/uor-r4 at `44e2a6f062e9196fe68291259bff459dde0bde44`
- Oracle: reuse 6.3.0 (REUSE Specification 3.3), SPDX License List 3.29.0
- Observed: 20509 files, 33 with copyright, 10 with licensing information; compliant: false

## License expression

Undetermined.

## LICENSES/

```sh
reuse download Apache-2.0
```

## Annotations

Each command adds a REUSE header, or a `.license` file beside a file that cannot carry a comment.

### 20468 files without a copyright notice or licensing information

```sh
reuse annotate --copyright='The Universal Object Reference Foundation (UOR)' --year=2026 --license='<EXPRESSION>' --fallback-dot-license --skip-existing --skip-global --recursive .
```

### 31 files with a copyright notice but no licensing information

```sh
reuse annotate --license='<EXPRESSION>' --fallback-dot-license -- archive/history/branch-archive/d22-constructor-unfinished-20261010.patch archive/history/branch-archive/d22-numerical-snapshots-20261010/patches/00-synthetic-attempt1.patch archive/history/branch-archive/d22-numerical-snapshots-20261010/patches/04-qualification-attempt2.patch archive/history/branch-archive/other-labs-20261009/issue-1107-workbench-candidate.local.patch archive/integration/publication-tooling.json archive/integration/review-2026-09-16/07-github-live-state.md archive/labs/consolidation-2026-10-09/preserved-source.bundle archive/labs/d29-vendor-boundary-2026-10-13/qualification/setup/nvcc-1791915278-0.stdout.log archive/labs/discrete-geometric-learning-2026-10-13/attempt2-identity.txt archive/labs/discrete-geometric-learning-2026-10-13/attempt3-identity.txt archive/labs/native-relation-learning-path-2026-10-17/compiler-gate3/lease.log archive/labs/native-relation-learning-path-2026-10-17/compiler-gate6/command.log archive/labs/prime-zeta-construction-2026-10-14/receipts/cuda-qualify-job.log archive/labs/propose-subphase-diagnostic-run-2026-10-16/transcript.log archive/r4_native_reference_1086_source_manifest.json archive/r4_service_contract_1105_source_manifest.json archive/vendor-snapshots/uor_standards/uor-addr/data/ucd/15.1.0/CompositionExclusions.txt archive/vendor-snapshots/uor_standards/uor-addr/data/ucd/15.1.0/DerivedNormalizationProps.txt archive/vendor-snapshots/uor_standards/uor-addr/data/ucd/15.1.0/NormalizationTest.txt crates/uor-r4-core/tests/hf_bpe_tokenizer.rs crates/uor-r4-core/tests/tokenizer_adapter.rs crates/uor-r4-integer/src/geometric_source_emission_view.rs crates/uor-r4-object-store/tests/bindings.rs crates/uor-r4-tokenizer/src/lib.rs crates/uor-r4-training/src/bin/prepare-text-parquet.rs
reuse annotate --license='<EXPRESSION>' --fallback-dot-license -- crates/uor-r4-workbench/assets/NOTICE.txt docs/loop/README.md tests/e2e/fixtures/long_horizon_20turn_scenarios.json third_party/helm-d-reference/UPSTREAM.toml tools/r4-softmax-trainer/NOTICE.md tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_control/NOTICE.md
```

### 8 files with licensing information but no copyright notice

```sh
reuse annotate --copyright='The Universal Object Reference Foundation (UOR)' --year=2026 --fallback-dot-license -- tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_clock/contract.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_clock/development.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_clock/sampling.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_continuation/contract.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_continuation/development.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_release/development.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_transfer/contract.py tools/r4-softmax-trainer/src/r4_softmax_trainer/zoology_transfer/development.py
```

## Check

```sh
reuse lint
```

## Open

- The license expression is not determined by the repository: its manifests and LICENSE texts are absent, unidentified or disagree (see the open claims in licensing/register.json). `<EXPRESSION>` stands for it until it is decided.
