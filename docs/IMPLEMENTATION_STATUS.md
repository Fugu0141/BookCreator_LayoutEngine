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

## M04 — bounded component Canvas

Nested groups may use canvas direction with fixed outer height, zero gap, padding, explicit child widths and nonnegative top-left x/y in micrometres. Existing layoutTree canvas geometry places premeasured children, overlapping allowed in tree order; overflow rejects rather than clips. Canvas participates in surrounding flow as an indivisible fixed-height group. Root still row/column, exactly one content slot. No anchors, rotation, full-page/spread canvas or image resources. Browser verification pending.

## M04 — component image preview (experimental)

A component may include a decorative image leaf with a stable SHA-256 asset ID, explicit positive physical height, fixed/fill width under existing flow rules, contain/cover fit and optional alternative text (empty for decoration). Canvas children require explicit dimensions and x/y. The host supplies a project-scoped verified PNG Blob via resolveImage; the component cannot supply a URL. Missing resolver, invalid PNG header, decoded size mismatch, excessive bytes/dimensions/pixels or decoding failure rejects the preview. Resolve and decode each unique image once per preview, close bitmaps on success/failure. Center contain preserves source ratio; center cover crops without modifying the source. Render into bounded canvas snapshots, max 2048 pixels on the long side, with a cumulative raster limit; this is a screen preview, not production-quality output. Image geometry participates in strict pagination and overflow validation; source slices still describe only the one semantic manuscript slot. No external resource URL, crop editing, JPEG/SVG, print resolution guarantees or PDF export. The host must verify asset identity and static PNG integrity. Actual browser tests added; CI pending.

### Non-destructive image crop

Optional crop stores four source-relative insets (left/top/right/bottom), integer basis points of original dimensions. Omitted crop is the full source. Opposite insets sum to at most 9900, retaining at least 1% per axis. Apply crop before contain/center-cover; physical frame and pagination are unchanged. Snapshot validates and copies crop before asynchronous decoding. Existing image assets and definitions remain valid. No raster source writes, no rotation, no arbitrary clip paths. Geometry and actual browser pixels are tested; CI pending.

## Fragmentable paragraph frame (experimental)

Measured blocks may specify nonnegative integer fragmentPadding top/bottom, reserved once per fragment including continuations. Split/avoid/strict consider padded height; a line plus padding must fit an empty page. Browser components with non-strict pagination are restricted to a column, zero gap and one semantic content slot, no decorations or nested groups. Measure at inner width; render repeated background and padding with exact contiguous source ranges on every page. Existing strict component trees remain unchanged. No continuation-specific decorations, orphan/widow rules or publication output. Unit and browser tests added; CI pending.

## M04 — independent named content slots (experimental)

Strict preview component trees retain exactly one primary content node and may add up to eight uniquely named slot nodes (lowercase ASCII identifier, 1–32 characters; content is reserved). Each named slot node has fixed/fill width, text color and existing flow/Canvas coordinates where applicable. The host passes namedSlots with a matching name, independent plain-text request (font family, weight, size, line height and text; width comes from the measured tree), and optional verified sourceTextStart. Missing, duplicated or unexpected slots fail closed. Source ranges must remain inside the block origin and not overlap each other or the primary range. All source text shares the existing 50,000-unit preview cap; each text is subject to the existing 10,000-unit request cap. Snapshot validation and copying precede asynchronous resource decoding. Measure each slot at its resolved width and include its measured height in recursive placement. The DOM exposes data-named-slot and local line offsets; one slice per paginated fragment is preserved for legacy callers, with namedSlots sub-slices containing independently mapped source ranges. Derived labels and decoration remain separate from semantic text. No concatenation of noncontiguous source ranges. Existing single-slot and fragmentable paragraph behavior is unchanged. Named slots are required if declared, strict/indivisible only; multiple flexible siblings in a row remain unsupported. No empty/optional slots, rich inline markup, multi-page named-slot fragmentation, BCM interpretation, desktop editing or PDF publication in this Engine PR. Actual browser coverage includes distinct fonts, wrapping, nested placement, exact ranges and invalid inputs; CI pending.

## M04 — hard line breaks and multi-paragraph source (experimental)

The line-based preview accepts opt-in multiline: true for primary and named text requests. LF and CRLF are measured as explicit hard breaks; each nonempty logical line wraps using the existing DOM/grapheme measurement. The original separator belongs to the last visual row of that logical line. Empty logical lines consume one line height plus optional paragraphGap (integer micrometres, 0–30000); a final separator alone does not generate an extra trailing row. Preserve all original UTF-16 offsets, including CRLF as a unit, without normalizing source text. Frozen rows retain separators in non-displayed DOM spans, preventing an extra visible row. Existing single-line mode still rejects newline characters. Standalone CR, other control characters, blank-only text and invalid settings are rejected. Limit 255 separators per request and 1024 per preview, in addition to existing text/geometry limits. This is explicit plain text, not Markdown parsing or typographic paragraph shaping. Empty rows are ordinary pagination units; no widow/orphan or paragraph-boundary keep rules yet. Strict multi-slot components stay indivisible; ordinary split blocks and fragmentable paragraph frames paginate by measured rows. Whole-block measurement API behavior is unchanged; multiline and paragraphGap are line-preview options. Browser tests cover mixed LF/CRLF, grapheme boundaries, gap, exact slices across pages and multiline named slots. CI pending. BookCreator adapter, theme controls and GUI multiline samples follow separately.

## M04 — typed inline text style runs (experimental)

The line-preview request accepts optional inlineStyles: a sorted list of non-overlapping, nonempty UTF-16 [start,end) ranges in the logical text. Each may override fontFamily (existing generic or host-registered family), fontWeight, italic, underline, and six-digit hexadecimal color. Uncovered text inherits the base style. Adjacent ranges are allowed; overlapping/nested syntax must be resolved to disjoint runs by the host. Both endpoints must be grapheme boundaries, including CRLF. No raw HTML, arbitrary CSS, font size overrides, baseline shifts, or URLs are accepted. Up to 128 runs per request, 1024 per preview, existing text/line caps retained. Requests and nested runs are validated/copied before asynchronous work; whole-block measurement rejects inlineStyles rather than silently ignoring it.

Measurement constructs typed text spans in the same browser DOM as the wrapping pass, waits for referenced trusted font faces, maps graphemes through the corresponding text nodes, then re-renders each frozen visual line with clipped style spans and verifies geometry. Multiline hard breaks preserve original logical offsets and style runs are clipped to each line. Primary and named slots share the same path. Existing pagination and exact contiguous sourceSlice contract are unchanged for literal logical text; when a host strips Markdown delimiters or otherwise transforms text, it must not claim contiguous source mapping and will need a separate source map. No markup parser or GUI formatting controls yet. Registered upright-only fonts may use synthesized italic slant; weight synthesis remains disabled. Mixed face metrics, complex shaping and unusual line box geometries may be rejected by existing geometry checks; this is not a general rich text shaping or publication engine. Browser tests cover styled wrapping, page fragmentation, multiline, named slots, real font-dependent wrap counts, mutation isolation and invalid intervals/properties. CI pending.
