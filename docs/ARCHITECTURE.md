# BookCreator Layout Engine — 独立組版ライブラリ基本設計

- 文書バージョン: 0.1.0
- 状態: 設計ドラフト。実装・PoC・公開パッケージなし。
- 関連: [BookCreator DESIGN.md](https://github.com/Fugu0141/BookCreator/blob/main/DESIGN.md) v0.8.3、[実装前レビュー](https://github.com/Fugu0141/BookCreator/blob/main/docs/PRE_IMPLEMENTATION_REVIEW.md)
- 文書処理ライブラリ: [BookCreator Markdown](https://github.com/Fugu0141/BookCreator_Markdown)
- 方針: TypeScript strict、Node.js/ブラウザ対応可能な共通コア、MIT公開を第一希望（依存確認後に確定）。

## 1. 目的と責務

宣言的な文書・部品ツリーと物理紙面の条件を入力し、ページ割付、部品の伸縮、断片化、ページ面、番号、動的参照などを決定する独立した組版エンジンを目指す。BookCreatorが最初の利用者となる。既存エンジンに不足する機能は独自開発し、既存の汎用文字計測・描画技術は適切に活用する。

コアはBCMのパーサー、BookCreatorのGUI、React、Electron、Git、ファイルシステム、特定のPDF生成器に直接依存しない。中立な型付きLayoutDocumentを入力とする。BookCreator側のアダプタがBCMのAST、テーマ、素材、出版設定を解決して入力を組み立てる。他形式の変換器は将来追加できる。BCMとLayout Engineが互いに必須依存する構成や循環依存は避ける。

| 担当 | 責務 |
| --- | --- |
| BCM | 構文、AST、原文範囲、属性、ID・参照索引、局所パッチ |
| BookCreator | テーマ・プロジェクトの保存形式、部品エディタ、文書から組版入力への変換、意味的採番・文献等の前処理、出版確定、ファイル・Git操作 |
| Layout Engine | 部品寸法・フロー・分割、ページ制約、物理面と見開き、ページ番号・位置依存参照、脚注配置、反復部品、PagePlan・診断 |
| 計測/描画アダプタ | フォント・文字組み・画像の計測、HTML/CSS/SVG等の固定ページ表示。能力・バージョン・資源を明示 |
| PDF出力アダプタ | 確定PagePlanに従って描画・PDF生成・検査。BookCreatorが出力ライフサイクルを管理 |

境界は暫定案。部品のレイアウト意味論と中立入力の正式スキーマはCOMPONENT_SYSTEMおよびLAYOUT_MODELの詳細設計で確定する。GUI用テーマYAMLを直接組版エンジンの唯一の入力にしない。組版器は原文やテーマを自動変更しない。

## 2. 処理パイプライン

    source document + theme + publication settings
                   |
          application adapter
                   |
             LayoutDocument
                   |
      normalize / validate / resolve
                   |
      measure -> paginate -> resolve page-dependent values
                   ^                        |
                   +------- bounded loop --+
                   |
                 PagePlan
                   |
          fixed-page render adapters
               /          \
        HTML preview      PDF export

組版入力は不変スナップショット。計測コンテキスト、入力revision、コンテンツ・素材・フォントの識別情報、エンジン・アダプタ・設定の版を含む入力指紋で結果を区別する。外部素材の読み込みはアプリが明示的に解決したリソースに限定する。計測結果を異なるコンテキストで再利用しない。

## 3. 公開API・データ契約の初期案

以下は型の概略であり動作するAPIではない。具体的なフィールド、数値単位、エラー型は詳細設計とPoCで確定する。

    interface LayoutInput {
      revision: string;
      fingerprint: string;
      document: LayoutDocument;
      publication: PublicationOptions;
      resources: ResourceManifest;
    }

    interface SourceOrigin {
      documentId: string;
      revision: string;
      blockKey: string;
      persistentId?: string;
      range?: { start: number; end: number };
    }

    interface MeasureAdapter {
      capabilities: MeasureCapabilities;
      environmentFingerprint: string;
      measure(request: MeasureRequest, signal?: AbortSignal): Promise<Measurement>;
    }

    interface PagePlan {
      schemaVersion: number;
      revision: string;
      fingerprint: string;
      completeness: "full" | "partial";
      pages: readonly Page[];
      diagnostics: readonly LayoutDiagnostic[];
    }

    layout(input: LayoutInput, adapter: MeasureAdapter, options?: LayoutOptions): Promise<LayoutResult>
    validatePlan(plan: PagePlan, input: LayoutInput): readonly LayoutDiagnostic[]
    projectOutput(plan: PagePlan, profile: OutputProfile): OutputPagePlan

LayoutDocumentは順序付きセクション、意味構造を持つブロック、インライン内容、部品ツリー、ページ指示、脚注・ページ依存参照を持つ。文字列HTMLを任意コードとして実行する入力にしない。識別子は原文の範囲を表現できるが、BCM専用型の必須依存は作らない。原稿以外から生成する場合は任意の安定した論理originを使用できる。意味的採番済みのラベルは入力側から渡し、ページ位置に依存する値はエンジンで解決する。必要な値が未解決なら診断する。

計測アダプタは単なるテキスト幅だけでなく、折返し行、分割可能境界、文字位置対応、ベースライン、画像寸法、数式/コード/表等の測定条件を返せることを目標とする。コアはDOMを直接参照しない。測定結果が不足して安全な割付ができない場合は未対応診断を出す。HTML/CSSによる計測と同じ描画条件で再現できるかをPoCで検証する。

PagePlanは計画内ID、論理ページID、role、内頁index・side・spreadId/position、印字番号とカウンタ、用紙/本文/予約領域、各断片のorigin・矩形・読み順・分割位置・描画情報、生成空白/改ページの理由を保持する。表紙には内頁spreadIdを付けない。出力プロファイルによるPDF通し位置はOutputPagePlanに投影し、元の内頁面を変更しない。UIの見開きプレースホルダーは実ページではない。矩形だけでは文字組みの再現性が保証されないため、行分割・描画情報の契約をPoCで定める。計画IDや断片の座標は原稿へ保存しない。

## 4. 初期の組版要件

### 4.1 部品・物理単位

row/column/stack/canvasの混在と入れ子、固定/auto/fill/%サイズ、内外余白、padding/gap、アンカー、z順、動的テキストを扱う。構造化コンテナはフローで計測し、canvasは解決可能な局所座標系を使用する。背景/装飾は読み順と区別する。負のサイズ、未解決の循環寸法、不正な座標を診断。単位換算・丸め・数値上限は詳細仕様で統一する。初期は横書き・左綴じ、同一寸法の本文ページを対象とし、右綴じ・縦書き・段組みは後続検討。

### 4.2 改ページと配置制約

明示pagebreak（any/left/right）、明示blank-page、ファイル境界の既定改ページ、start-position（flow/page-top/spread-start-top/spread-end-top）、split-policy（allow/avoid/strict）、keep-with-next/previous、最低行数、ページ境界余白を処理する。

- 既に適切なページ先頭なら冗長な改ページを発生させない。明示空白は維持。
- 出版構造の固定ページ/固定見開き・番号区間を維持。明示的な面指定の衝突はエラー、テーマ既定と明示指定の競合は明示指定を優先して診断。
- continuousは当該セクション先頭の通常フローブロックの部品由来startPositionだけを抑制する（Q12 A）。途中のブロック、明示pagebreak、物理的不足は通常通り処理する。空行/コメントを飛ばし、空セクションから抑制を引き継がない。
- allowは安全な境界で分割、avoidは収まれば一ページに維持し必要時に警告付き分割、strictは一ページに収まらなければエラー。overflowPolicyはstrictを緩和しない。
- 段落は行境界、コードは論理行または許可された折返し境界、表は許容される行境界を候補とする。実際の分割単位・継続装飾は詳細設計で規定。
- 不可能な配置を繰り返さず、各ステップで原稿位置の前進・必要な面調整・明示空白の消費・診断停止のいずれかを保証する。内容を無断でクリップ・縮小・消去しない。

### 4.3 見開き・固定ページ

内頁の初面をleft/rightから明示し、表紙・裏表紙・内頁の役割を分離する。通常見開きの面は印刷番号やPDF通し位置から推測しない。固定見開きCanvasは二面を占有し、開始面へ配置する。綴じ目を跨ぐ装飾は同一座標で二面に分割描画し、重要文字や安全領域の重なりを診断する。表紙込み電子閲覧用と両面印刷用を区別し、後者のみ面調整用の実空白を必要に応じて追加する。内頁番号を維持する。冊子面付け・背表紙展開図は対象外。

### 4.4 脚注・参照・反復部品

予約領域とoverlayを区別する。反復部品は通常本文の改ページを直接発火させない。本文幅や高さを変える予約領域は計測・配置前に解決する。章末限定など事後にしか判定できない条件、脚注、目次、ページ参照は有限回の再組版で解決する。状態署名で安定と循環を検出し、反復上限・資源上限で停止する。脚注を無断で末尾注に変更しない。未収束結果は正式確定不可。脚注の分割、表のヘッダー反復、装飾の断片化、ページ末条件は詳細設計に残す。

## 5. HTMLプレビューとPDF

HTMLによる全体プレビューを出版確認に使い、利用者が出力するときだけPDFを生成する（Q09）。確定PagePlanを固定ページ描画の入力とし、PDFレンダラーに独立した改ページ判断をさせない構成を優先する。フォントロード、画像、物理寸法、倍率、印刷CSS、背景、クリッピングを一致させる。描画・PDFアダプタを分ける場合も同一の意味・計測条件を保証できるか検証する。PDFのテキスト選択、フォント埋込み、リンク、数式の品質を確認する。ページ数・サイズ・内容・配置の不一致は正式出力失敗として扱う。確認・検査・既存PDFの保全は利用アプリが担当する。

Chromium/HTML/CSS/SVGを最初の計測・描画候補とするが、完全一致やブラウザのみの正式PDF生成は未検証。Web版PDF方式は保留、ローカル生成優先。コアはネットワークを要求しない。必要な場合は既存エンジンを比較し、MIT希望・機能・性能・保守性と合わせて採用方式を判断する。

## 6. リポジトリ/モジュール案

    src/
      model/         # 中立入力・PagePlan・スキーマ
      geometry/      # 単位・寸法・座標
      components/    # row/column/stack/canvas
      measurement/   # 計測契約とキャッシュ
      constraints/   # 制約の解決・診断
      pagination/    # フローと断片化
      publication/   # 面・見開き・番号・出力投影
      dynamic/       # 脚注・ページ参照・反復・収束
      diagnostics/
      index.ts
    adapters/
      browser/       # DOM/Chromium計測・固定HTML描画の候補
    tests/
      fixtures/
      conformance/
    docs/

コアの公開APIとアダプタは分離。TypeScript/ESM、npm配布、SemVerの候補を記録する。パッケージ名、Node最低バージョン、モジュール分割、ライセンスは未決。CIは型検査、単体テスト、ブラウザビルド、fixture、依存ライセンス確認を目標とする。任意HTML/CSS/JSの実行、ファイルアクセス、PDFへの出力先書込みはコアの責務外。未知/不正入力は診断し、安全な深さ・ページ数・時間・メモリ上限を設ける。

## 7. 詳細設計・PoCの順番

- [LAYOUT_MODEL.md](LAYOUT_MODEL.md): 中立入力、部品の型とサイズ意味論、計測契約、PagePlan。
- [PAGINATION.md](PAGINATION.md): 改ページ・分割アルゴリズム、制約優先順位、断片とorigin。
- [PUBLICATION_RENDERING.md](PUBLICATION_RENDERING.md): 内頁面・固定見開き・番号区間・電子/両面印刷投影、計測・描画。
- [DEVELOPMENT.md](DEVELOPMENT.md): 独立fixtureとBCM/BookCreator統合fixture、実装順・合格判定。

詳細設計の初稿を作成済み。各契約はBookCreatorの部品仕様と整合させ、同一の意味を複数リポジトリで独立に定義しない。PoCの結果により未達機能を記録し、利用者に必要な判断を求める。

| ID | 最小検証 | 合格条件（提案） |
| --- | --- | --- |
| LE-01 | BCMを使わない中立入力 | 独立コアからページ計画を取得 |
| LE-02 | 長いH1、row+stack装飾、Canvas | 伸縮・アンカー・読み順、欠落なし |
| LE-03 | 分割可能/回避/strictと長いコード・表 | 適切な断片、strictは収まらなければ停止 |
| LE-04 | continuous先頭H1と途中H1 | 先頭だけ抑制、手動指示は有効 |
| LE-05 | 表紙・内頁・固定見開き・空白 | 面・番号・出力投影を区別 |
| LE-06 | 脚注・目次・反復予約領域 | 安定結果または原因付き停止 |
| LE-07 | 断片から原文への対応 | 位置・revision・境界理由を取得 |
| LE-08 | HTML確定からPDF生成 | ページ数・寸法・内容・配置の整合を実測 |
| LE-09 | 取消・巨大入力・循環サイズ | 進捗なし/資源超過を検知、旧結果を誤使用しない |
| LE-10 | Node/ブラウザ、3OS描画条件 | コアの共通性と計測環境差の診断 |
| LE-11 | 100ページ・50画像の縮小/実規模試験 | 再組版時間・メモリ・キャッシュの実測を記録 |
| LE-12 | 既存エンジンとの比較 | 機能差・工数・ライセンス・PDF品質を記録 |

全項目未検証。独自エンジンのリポジトリ作成は、既存エンジンの排除や正式版の完成を意味しない。
