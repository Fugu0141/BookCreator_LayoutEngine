# BookCreator Layout Engine

A proposed independent TypeScript pagination and document layout engine for structured and freeform book design.

BookCreator Layout Engineは、宣言的な文書・部品データからページ割付、部品の伸縮、見開き、ページ番号、脚注等を処理する独立した組版ライブラリです。BookCreatorを最初の利用アプリとしますが、BCMや特定のGUIに必須依存しない中立入力を目指します。

**Status:** Initial implementation 0.0.1: physical units, simple flow geometry and anchor offsets. Pagination and rendering remain pending.

## Goals / 目標

- Structured flow and freeform canvas layout.
- Pagination constraints, fixed pages and spreads, stable source mapping.
- PagePlan shared by preview and PDF rendering adapters.
- Local-first processing with a browser-compatible core.
- Reuse general text measurement/rendering technologies; implement missing layout capabilities independently.

## Documentation / 設計書

- [Architecture and proposed API](docs/ARCHITECTURE.md)
- [BookCreator application design](https://github.com/Fugu0141/BookCreator/blob/main/DESIGN.md)
- [BookCreator Markdown](https://github.com/Fugu0141/BookCreator_Markdown)

- [Layout model](docs/LAYOUT_MODEL.md)
- [Pagination](docs/PAGINATION.md)
- [Publication and rendering](docs/PUBLICATION_RENDERING.md)
- [Implementation and fixture plan](docs/DEVELOPMENT.md)

- [Cross-project development plan](https://github.com/Fugu0141/BookCreator/blob/main/docs/DEVELOPMENT_PLAN.md)


## Local development / ローカル開発

Node.js 22 or later and npm are required. Run from this repository:

```sh
npm install
npm run typecheck
npm test
```

TypeScript 5.8.3 is pinned. The lockfile is not yet generated; see [implementation status](docs/IMPLEMENTATION_STATUS.md). GitHub Actions is configured for initial checks; full conformance is pending.

## License / ライセンス

MIT is the intended license, subject to dependency review and final confirmation. No final license has been selected and no package has been released.

### Experimental Layout Inspector

    npm run build
    npm run layout-inspector -- plan fixtures/measured-input.json --measure fixture

Returns JSON with measured-page fragments and diagnostics. 0 = full placement in the experimental subset, 1 = invalid input or incomplete placement, 2 = usage/I/O error. Always publicationReady=false for plans. Does not read referenced manuscript/assets or generate PDF.
