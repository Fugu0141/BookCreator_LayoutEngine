# Layout Engine — 中立モデル・部品配置契約

状態: 詳細設計ドラフト。配置意味論、計測契約、PagePlanの正本。本体のテーマYAMLやBCM文法は利用側の責務。型例はPoC後に正式化する。

## 1. 入力と識別

LayoutInput = {schemaVersion, revision, fingerprint, document, publication, resources, environmentFingerprint}。
LayoutDocument = ordered sections + blocks + semantic references + footnote definitions + repeat rules。
Section = {id, role, startOn, blocks}。cover/blankは専用型。Block = {key, origin, kind, tree, pagination, constraints, semanticLabel?}。明示ページ指示・固定面・固定見開き・生成一覧は通常ブロックと区別したunion型。Origin = {documentId, revision, blockKey, persistentId?, range?}。rangeはUTF-16半開区間、BCMなしでも論理originを渡せる。入力は読取専用。参照リソースは内容ハッシュ・型・サイズ・識別子、フォントはface/weight/style/実体fingerprintを持つ。コアで任意のファイル/URLを開かない。

## 2. 長さ・座標

物理単位を基準にする。1in=25.4mm=72pt、画面CSS pxは1in=96px換算。保存値の丸めと描画時の丸めは別。内部の初期案は整数マイクロメートル（1mm=1000単位）、変換は境界で1回、端数の配分は最後の対象へ決定的に付与。文字計測の精度不足が出た場合はより細かい単位へ変更しスキーマ版を更新。全数値有限、safe integer範囲とリソース上限を検証。座標原点は親の左上、x右/y下。ページは用紙矩形・本文矩形・予約領域を持つ。幅の%は親の利用可能幅、高さの%は親の確定高さがある場合に限る。auto=内容計測、fill=確定した利用可能領域/残余、fixed=物理値。min/max矛盾はエラー。padding/margin/gapは別、負の通常余白不可。

## 3. 部品ノードの意味論

Nodeはid/type/common geometry/style/children等の判別共用体。型はrow,column,stack,canvas,text,text-slot,rect,line,ellipse,image,icon,spacer。子IDは定義内一意。text-slotは型付き内容から解決したテキスト/インライン/ブロック等を入力として持つ（型と実際のノードの互換を検証）。装飾はsemantic=false等で読み順から除く。表、リスト、コード、数式、脚注は意味的なブロック/インライン型を持ち、計測器の対応能力を明示。

| 型 | 幅・高さ計算 | 子の配置 |
| --- | --- | --- |
| row | 主軸固定分・gap・margin→残余をfill子へ配分、交差軸は最大高さ | 横方向、整列/伸縮 |
| column | 主軸高さは子の高さ+gap+margin、幅は確定幅または最大幅 | 縦方向 |
| stack | flow子の占有領域または明示寸法を先に決定 | overlayは確定領域に追従 |
| canvas | 幅と高さまたは幅と比率から確定 | 局所座標、アンカー、回転、z |

rowの高さfillの装飾は非fillの計測済み子で得た高さに追従する。fillしかないauto主軸、親autoと子%/fillの循環等は拒否する。横方向の複数fillは初期は等配分を提案し、min/maxの再配分と不足を診断。詳細な優先度・weightは検証後。通常フローは横/縦方向の順序を変えず、伸縮で本文を切捨てない。上下marginは加算、ページ境界のkeep/suppressに従う。marginのためだけに空ページを作らない。

Canvasアンカーはleft/topなら座標を端からの距離、right/bottomなら反対端からの距離、centerなら中心からの符号付きオフセット。stretchなら両端insetを指定し寸法を導く。アンカーと矛盾する幅/座標は診断。回転中心は初期既定中心。回転後の軸平行境界と実描画の交差を検査する。z順は兄弟間で明示、同値は文書順。配置の重なりは意図的装飾なら許可、意味的内容の欠落/クリップはエラー。stackのoverlayは占有領域を増やさない。

## 4. 計測契約

MeasureRequest = {node/content, availableWidth, availableHeight?, font/resource/context fingerprint, continuation?}。
Measurement = {size, baseline?, fragments, breakCandidates, sourceRanges, diagnostics}。
breakCandidatesには行/コード論理行/表行/子ブロック境界の識別子と断片寸法、分割可否を含む。sourceRangesは描画断片と原文または論理位置を対応づける。文字幅だけで行分割を決めない。Unicode grapheme/日本語禁則/双方向文字・フォントfallback等は実際の描画器に整合させる。フォント・画像読み込み完了前の測定は暫定結果扱い。capabilitiesで対応する分割/数式/表等を宣言し未対応の必須内容は診断停止。キャッシュは全測定入力と環境fingerprintに依存。非同期・取消をサポート。

## 5. PagePlanと不変条件

PagePlan = {schemaVersion, revision, fingerprint, completeness, pages, diagnostics, convergence}。
Page = {pageId, logicalPageKey, role, interiorIndex?, side?, spreadId?, spreadPosition?, assignedNumber?, printedLabel?, paper, content, reservedRegions, fragments, blankReason?}。
Fragment = {id, origin, continuationIndex, sourceSlice?, rect, transform?, clip?, readingOrder, paintOrder, renderData, breakReason?}。

logicalPageKeyは同一計画から出力を投影するときの照合用で、再組版を跨ぐ永続IDではない。fragment.idは計画内一意。表紙に内頁面なし。番号未割当と非印字は別。各断片は有限な矩形・再現可能な行/描画データを持ち、同一原稿内容を意図なく重複/欠落させない。読み順と描画順は別。反復装飾・表ヘッダーの繰り返しは明示された派生断片とする。UIプレースホルダーはpagesに含めない。OutputPagePlanはPagePlanとprofileからPDF順/面調整空白を投影し、内頁配置を変更しない。出力に影響する条件を変えたら再検査。

LM-01 寸法換算、LM-02 fill/auto循環、LM-03 動的H1と装飾、LM-04 Canvasアンカー/回転、LM-05 計測と原文対応、LM-06 PagePlanの検証、LM-07 非依存の中立入力。全て未実装。
