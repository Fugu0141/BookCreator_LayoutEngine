# Layout Engine — 実装・PoC計画

状態: 未実装。中立モデルはLAYOUT_MODEL、分割はPAGINATION、面・描画はPUBLICATION_RENDERING。全体計画は [BookCreator DEVELOPMENT_PLAN](https://github.com/Fugu0141/BookCreator/blob/main/docs/DEVELOPMENT_PLAN.md)。

## 作業順

1. TypeScript strict、最小パッケージ、型検査・テスト、ブラウザビルド。依存版・ライセンス記録。
2. 中立入力、型検証、物理単位、模擬MeasureAdapter、部品サイズ/座標を実装。LM-01〜07、LE-01/02。
3. 模擬計測でフロー、断片、制約、内頁面、番号、固定見開きを実装。PG-01〜07/11、PR-01〜04。
4. HTML/Chromium等の実計測・固定ページ描画を検証。行/原文対応、フォント読込、画像、数式、表、コード、PDFの再現性を測る。LE-07/08/10、PR-05〜08。
5. 脚注・目次・反復予約領域の収束、資源上限、取消。LE-06/09、PG-08〜10。
6. BookCreator共通fixture、100ページ・50画像規模と小規模の計測、既存エンジンと比較。LE-11/12。採用判定・未達・代替案を記録。
7. API/版、配布・依存ライセンス、実測済み能力をレビューし開発版へ。

## 模擬計測と実測の分離

模擬計測は入力node/widthごとに既知の高さ・分割候補を返し、ページ割付の純粋な期待値を検証する。実フォントやHTMLの品質保証には使わない。実測adapterはバージョン・フォント・設定・環境fingerprintを記録する。PagePlanの期待値はページ順、各断片のorigin/range、面、番号、座標、境界理由、診断を含む。紙面の視覚差・文字欠落・リンク等を独立に検証する。性能・許容差は測定後に数値化する。

BCMやGUIを必要としないfixtureで独立性を確認。コアは描画/ファイルAPIを必須にしない。PDF出力先や出版確定は利用アプリが管理。既存技術で不足する機能は独自実装を検討するが、未達を隠さない。MIT License確定・ローカル優先。依存・配布素材の権利確認とWeb正式PDF方式は引き続き検討する。全項目not-run。
