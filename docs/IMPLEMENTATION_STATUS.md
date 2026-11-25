# First development milestone (0.0.1)

Implemented: integer micrometre length conversion, deterministic equal fill distribution, simple row/column positioning of premeasured rectangles, anchor offsets and overflow rejection. This is geometry only, not a document pagination engine. LayoutDocument/PagePlan, dynamic measurement, recursive tree, stack/canvas, break constraints, page faces, rendering and PDF remain unimplemented. API experimental. Local Node 22.16.0 / TypeScript 5.8.3: five unit tests passed on the working copy. Full conformance not run. npm installation/lockfile generation could not be performed due to network restrictions. Generate and commit package-lock.json and switch CI to npm ci before reproducible release. License remains undecided, no npm publication.

## Second development milestone

Added layoutTree, recursive row/column/stack/canvas and premeasured leaf geometry, fixed/auto/fill sizing, equal main-axis fill, cross-axis fill for fixed-main decorative leaves, anchored overlay and duplicate-ID/cycle/overflow rejection. Coordinates are parent-relative integer micrometres. This is a limited geometry PoC: no real text measurement or wrapping, percentage/min/max/padding/margin, rotation, complete stretch/align, pagination or rendering. Unsupported sizing combinations may be rejected; no publication use yet. Four new tests; 9/9 local tests passed (Node 22.16.0, TypeScript 5.8.3).

## Third milestone — measured pagination PoC

Experimental paginateMeasured: single-column premeasured units, origin ranges, allow/avoid/strict, explicit pagebreak and continuous first component page-top suppression, partial/error and resource limits. Not the final PagePlan contract; never publication-ready. No actual measurement, page faces, margins, footnotes or rendering. Added five tests; local full run and CI not yet verified.

## M03 continuation — Layout Inspector CLI

Added inspectMeasuredInput for strict JSON shape checks and a read-only fixture pagination CLI. Invalid and unknown layout fields are rejected; no actual text measurement, faces, margins or PDF. Added a sample input and two tests. Prior pagination core CI succeeded; new tests pending verification.

## M04 — browser text measurement PoC

Added measurePlainText for actual DOM height/wrapping at a specified physical width, generic font family and line height, after document fonts readiness. Literal text only, isolated shadow tree, cleanup, bounded input, whole-block only. A real Chromium smoke test compares narrow/wide wrapping, conversion, cleanup and pagination using measured heights. No line-break/source-slice mapping, font fingerprint, image measurement, app UI, rendering or PDF yet; never publication-ready. New browser CI pending verification.

## M04 continuation — actual line measurement and frozen HTML preview

Added measurePlainTextLines and createPlainTextPagePreview for a restricted plain-text subset: actual browser grapheme geometry, UTF-16 logical ranges, measured line units, multi-page plan and fixed-position DOM. No newline/control/format characters; ambiguous geometry and overflow rejected. Origin is preserved but logical offsets are not presumed raw Markdown offsets. No font fingerprint, bidi/shaping fidelity guarantee, resource measurement, orphan/widow rules, renderer equivalence or PDF. Preview is never publication-ready. Extended browser smoke test; CI pending.

## M04 — registered font faces and weights

Browser measurement and frozen HTML use identical font family/weight settings. Supports generic families and host-registered opaque BCFont_ aliases, rejects arbitrary CSS and unavailable registered faces, waits for FontFaceSet.load and disables synthetic styling. The host owns actual font files, registration and fingerprint. This does not prove glyph coverage or exact face/weight selection; no font import, embedding or publication readiness. Browser tests pending.

## M04 — whole-book experimental paper preview

Multiple ordered sections and explicit page breaks are accepted by the browser preview; continuous sections retain the core first-component suppression rule. Optional physical paper bounds and mirrored inner/outer margins wrap the existing content plan; first side controls parity. Content coordinates remain content-relative. No cover, blank, spread or publication output. Browser tests pending.

## M04 — strict flat flow component preview

A plain text block may carry a neutral restricted row/column component: exactly one content slot, up to seven decorative rectangles, physical gap/padding and literal hex colors. Text measured at reduced width, existing layoutTree places premeasured children, outer height enters pagination as a single strict unit. Same DOM rendering path for samples and book pages. Source ranges preserved; decorations aria-hidden. No arbitrary CSS, nested/Canvas/fragmentable components, literal extra text or publication readiness. Browser tests pending.

## M04 — fixed component labels

Strict flat row/column preview components accept measured fixed text labels (bounded text, physical width, independent registered font, weight, size and line height, hex color). Labels participate in geometry and pagination but never alter semantic content-slot source slices. No nested structures or publication readiness. Browser verification pending.

## M04 — recursive flow component groups

Nested row/column groups (depth ≤4, 32 total children, 8 per group), fixed/fill widths, one flexible child per row, physical padding/gap/background. Resolve widths top-down, measure leaves, place groups bottom-up with layoutTree, render recursively from the resulting geometry. Exactly one source slot across the tree. Reject overflow and ambiguous fill; strict pagination only. Browser tests pending.
