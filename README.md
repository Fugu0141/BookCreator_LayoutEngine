# BookCreator Layout Engine

A proposed independent TypeScript pagination and document layout engine for structured and freeform book design.

BookCreator Layout Engineは、宣言的な文書・部品データからページ割付、部品の伸縮、見開き、ページ番号、脚注等を処理する独立した組版ライブラリです。BookCreatorを最初の利用アプリとしますが、BCMや特定のGUIに必須依存しない中立入力を目指します。

**Status / 状態:** Architecture draft only. No implementation, conformance results, or npm release yet.

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

## License / ライセンス

MIT is the intended license, subject to dependency review and final confirmation. No final license has been selected and no package has been released.
