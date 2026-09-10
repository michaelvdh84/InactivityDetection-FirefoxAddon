# Task 1 report

## Implementation

- Added `kioskRestrictionsCore.js` with an immutable API for rule validation,
  HTTPS host/path matching, selector expansion, and built-in FAS/IBZ rules.
- Added table-driven tests covering exact hosts, bounded/case-insensitive paths,
  HTTPS-only URLs, disabled rules, malformed input, duplicate IDs, selector
  syntax, normalization, and explicit array limits.
- Normalized hostnames to lowercase and path trailing slashes, while returning
  newly allocated normalized rule objects.

## Tests/results

- RED: `node --test tests/kioskRestrictionsCore.test.js` failed as expected
  before implementation because the module/API was missing.
- GREEN: `node --test tests/kioskRestrictionsCore.test.js` — 6 passed, 0 failed.
- Syntax: `node --check kioskRestrictionsCore.js` — passed.
- `git diff --check` — passed.

## Self-review

- API is frozen and exported through both CommonJS and the Firefox global.
- Matching uses exact lowercased host equality, HTTPS-only URL parsing, and
  exact-or-slash-boundary path matching.
- Validation errors include the rule index and field name; selector validation
  accepts the injected validator shape.

## Concerns

The design specifies array caps but only says string lengths are bounded; the
brief did not provide exact string limits. I chose conservative limits of ID
64, hostname 253, path 2048, and selector 512 characters. These should be
confirmed if an authoritative limit is supplied.

## Fix Round 1

- Updated `tests/kioskRestrictionsCore.test.js` with malformed URL cases and
  exact-at-limit/over-limit coverage for IDs (64), hostnames (253), paths
  (2048), and selectors (512), in addition to the existing array-cap tests.
- `node --test tests/kioskRestrictionsCore.test.js`: 8 passed, 0 failed.
- `node --check kioskRestrictionsCore.js`: passed.
