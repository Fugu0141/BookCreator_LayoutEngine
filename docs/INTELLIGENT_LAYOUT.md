# Intelligent_Layout — ユーザー主導の自動配置

状態: 段階的導入。既存の組版・PagePlan・PDFの経路は変更しない。

## 優先順位

1. 原稿の内容・読み順・明示改ページ・固定位置/サイズ・意図的な余白を保全する。
2. 用紙、本文矩形、予約領域、測定済み文字の収容条件を守る。
3. 許容された候補だけで希望配置への近さ、前回配置の安定性、余白バランスを評価する。
4. 条件を満たさない場合は競合と対象を提示し、最後の有効計画を維持する。固定解除、縮小、順序変更を自動実行しない。

配置モード: 自動 / 優先指定（希望と許容範囲） / 固定（厳密制約）。自動配置の結果は派生データであり、明示したユーザー意図だけを保存する。AI・外部サービスを必要としない決定的な計算を初期方式とする。

## IL-01: 独立した測定済みブロック配置

planIntelligentLayout は整数µmの本文相対矩形、revision、順序付きの不可分ブロックを受け取る。既定は縦フロー、隣接する双方が許可した場合に限り同じ行に横配置する。明示余白 spaceBefore、改ページ startNewPage、ページ番号（0始まり）とXY固定座標を尊重する。寸法を変更しない。固定されたブロックは独立行で扱う。競合は全候補を破棄し、対象IDを返す。入力は変更しない。出力は出版可能なPagePlanではない。

制限: 貪欲な行配置であり、最適解探索はしない。IL-03で予約領域を回避するが、原稿内の固定ブロックは独立行を維持する。既存の行・数式・画像計測と分割、脚注、予約領域、セクション、永続ID解決は未接続。ページ間で固定を再割付しない。startNewPage は先頭で空ページを発生させない。

## IL-02: 優先指定とGUI接続契約

IntelligentBlock.mode は auto | preferred | fixed。省略時は fixed、preferred フィールド、auto の順に推定し旧入力を維持する。fixed と preferred の同時指定やモードとの不一致は IL_INVALID。座標は整数µm、本文相対、ページは0始まり。size は全モードで測定済みの不変寸法。

preferred は {page,x,y} の希望位置。自然なフローで到達するページで、先行ブロック・余白・紙面制約を満たす独立行に限り採用する。希望だけで空ページを生成しない。採用できない場合は通常フローに戻す。希望の採用が後続固定を妨げる場合は、全希望を無効にして通常フローを1回再試行する。後続固定を変更しない。保守的な2パス方式であり、希望の組合せ探索と許容範囲指定は後続。

配置結果の preference は希望指定ブロックのみ honored | fallback。最終座標が希望と一致すれば honored。fallback はGUIで非破壊の通知として扱い、保存済み希望を上書きしない。競合時は従来どおり placements=[] と診断。revision が現在の原稿と一致する場合のみ表示し、publicationReady=false の結果をPDFに渡さない。同期純粋関数のためイベントは発火しない。GUI側が revision と操作トランザクションを管理し、placed / conflict / preference fallback をUI通知へ変換する。永続化するのは明示したモード・座標・余白などの意図のみ。

### GUI連携設計（GUI未実装）

BookCreator側は最新revisionの原稿ブロックを選択できる紙面オーバーレイを設ける。ドラッグ中はローカル仮表示、ドロップで一回のトランザクション。自動フローでのドロップは明示的な順序変更としてプレビューし、絶対位置への固定とは区別する。固定・優先指定・自動へ戻す操作を明示する。横幅変更は再計測し、縦占有は余白または最小高さとして扱い、本文を切り落とさない。分割されたブロックの断片は同じ永続IDに結び、古いrevisionや曖昧なIDへの適用を拒否する。未保存案を示し、Undo/Redo・キャンセルを利用可能にする。BCM原稿は正本、配置意図の永続化スキーマは別途確定する。

## IL-03: 予約領域を保全する配置

IntelligentLayoutInput.reservedRegions は省略可能な readonly IntelligentReservedRegion[]。各領域は {id,page,rect:{x,y,width,height}}。整数µm、本文相対、0始まりページ、正の寸法、本文範囲内、領域IDは領域集合内で一意。重複領域は和集合として扱う。領域は原稿ブロックではなく、空白・脚注などの予約矩形であり、出力 placements に含めない。接触は許可するが内部の重なりは禁止。gap はブロック間の間隔で、領域外周に余裕が必要なら入力側が領域に含める。

通常の新規行は先行行の下端＋gap＋spaceBefore を下限に、置ける最上段・最左の空き矩形を検索する。同じ行は双方の sideBySide 許可時だけ右へ進む。予約領域の下端を候補にするため、物理単位を1ずつ探索しない。全面予約ページは飛ばすが、配置対象のない末尾の予約ページを出力ページとして生成しない。固定座標が予約領域と交差すれば IL_RESERVED_CONFLICT と blockId / regionId を返し、位置を変更しない。優先指定が領域に交差する場合は preference=fallback。領域なしの既存入力と出力は互換。

上限は全領域10000件、1ページ128件、ページ数10000。上限・入力不正は診断停止。予約領域はページごとに索引化。既存の固定ブロックを別の予約領域として重複登録しないこと。固定ブロック自体の左右に原稿を回すこと、複数候補の大域探索、予約領域をPagePlanへ反映することは後続。GUIは明示余白・予約領域を固定の制約として渡し、競合時は両IDを選択可能にする。プレビュー上の領域は原稿の読み順に追加しない。

## IL-04: 寸法制約・横縦占有率

IntelligentBlock.sizeConstraints は省略可能。minWidth / minHeight / maxWidth / maxHeight は正の整数µm。minWidthPercent / minHeightPercent は整数1–100、本文矩形全体の対応軸を基準にする。割合の下限は切り上げ。占有寸法は各軸で測定寸法・物理下限・割合下限の最大値。最大値を超える場合は IL_SIZE_CONFLICT と blockId を返し、縮小しない。固定ブロックに測定寸法を超える最小占有寸法を指定した場合も競合とし、暗黙の拡張を禁止する。用紙寸法を変更すると割合は再計算するが、固定指定を無断で変更しない。

IntelligentPlacement.rect は従来どおり測定済み内容の矩形。占有が大きい場合のみ occupiedRect を追加する。起点は同じで、増えた領域は右・下側の空白。GUI は occupiedRect ?? rect を占有枠、rect を内容枠として表示する。占有領域を変えることは文字の折返しや描画サイズの変更ではない。内容幅を変更する操作は既存計測器で再計測した size を明示的に渡す必要がある。IL-04 では再計測しない。

spaceAfter は非負整数µm、最大寸法評価後に占有高さへ加算する独立した明示余白。spaceBefore と同じく行を分離し、当該行の横並びを禁止する。用紙内に収まらない場合は診断し、空白を削除しない。固定位置と内容寸法は維持したまま明示 spaceAfter を確保する。予約領域との交差、横並び、ページ送りは占有矩形で判定する。未指定時は従来の結果形状を維持する。

この契約は IL 内部の測定済みブロック用で、既存部品の minHeightPercent 等の実際の描画・計測との接続は後続。二重適用を避け、GUI は内容寸法と占有指定を区別して保存する。

## IL-05: 有界な配置候補の比較

planIntelligentLayout(input, options?) の第二引数 IntelligentOptimizationOptions を指定した時だけ候補探索を有効にする。省略時の結果と計算経路は従来どおり。options={} で有効化できる。previousPositions は {id,page,x,y} の旧結果を最大10000件渡せる（ID一意、整数µm、0始まりページ）。削除済みIDは評価に影響しない。旧座標はソフトな安定性ヒントであり、ユーザー意図ではない。利用側は同一文書の安定したIDと比較可能な座標系のみ渡す。

候補は従来の貪欲配置と、1ブロック先読みで横並びの組を変更する配置の2種類。希望位置がある場合は全希望を無効にした両方式も比較し、最大4回の純粋計算。全候補で同じ入力検証・固定・余白・予約領域・寸法・読み順制約を守る。不成立候補は評価しない。先読みは予約領域のないページで、横並び許可の隣接3ブロックを含む局所的な組み合わせに限定し、改ページ・固定・希望位置・明示前後余白を無断変更しない。次の2ブロックを組にすると行高さ合計が減り、紙面に収まる場合のみ新しい行を選ぶ。

比較順（辞書式）: 1. 希望実現数を最大化、2. ページ数を最小化、3. 旧ページ番号との差の絶対値合計を最小化、4. 旧XYとの差の絶対値合計を最小化、5. 各配置ページの最下占有端の合計を最小化。同点は先に生成した候補（貪欲を優先）。意図的な余白は評価によって削らず占有矩形に含める。希望実現を優先するため、ページ数増加を許容する場合がある。

成功時に optimization を追加: evaluatedCandidates / feasibleCandidates / selected / score。selected は greedy | lookahead | greedy-fallback | lookahead-fallback。score は honoredPreferences / pageCount / previousPageDistance / previousPositionDistance / occupiedDepth。候補数は試行回数であり、異なる配置数ではない。全候補が不成立なら競合のみ返す。結果は publicationReady=false のまま。GUI は比較結果を診断表示に利用できるが、旧座標やスコアを原稿へ保存しない。

局所先読みと有限候補比較であり、全組合せ探索・均等な紙面余白の評価・部分的な希望解除・固定ブロック回り込み・旧座標を起点とした候補生成・キャッシュは後続。性能実測前なので最適化は明示 opt-in とする。

## IL-06: 既存の計測・分割モデルとの接続（実験的）

新設 src/intelligent-measured.ts の planMeasuredIntelligentLayout(input: PaginationInput, options?: IntelligentMeasuredOptions) は既存の paginateMeasured を実行し、得られた安全な断片を IL の不可分ブロックとして配置する。既存の行高、分割方針、反復 fragmentPadding、origin、unitStart / unitEnd / continuationIndex を維持する。厳密分割禁止・収まる avoid は既存の判定を利用し、avoid 分割の警告も返す。既存ページ計画の explicit / section / page-top / continuation は強制改ページとして継承し、通常の overflow は再配置できる。空ページの扱いは既存の冗長改ページ抑制に従う。既定 gap=0、最適化は明示指定のみ。

options.intents は {documentId,blockKey,placement} の配列。placement は mode / fixed / preferred / sideBySide / sizeConstraints / spaceBefore / spaceAfter / startNewPage。指定は一意かつ単一断片の原稿ブロックに限定し、不明・重複・複数断片の指定は IL_MEASURED_INTENT で全体を拒否する。原稿の改ページ指定は false で解除できない。断片IDは intelligentMeasuredId(origin, units?) で生成する。単一断片は JSON 配列 [documentId,blockKey]、複数断片は [documentId,blockKey,unitStart,unitEnd]。分割境界が変わると断片IDも変わるため、永続的なユーザー意図は原稿IDに紐付ける。利用側は安定した blockKey と現在の revision を提供する。別文書の同じ blockKey は区別する。reservedRegions と optimization は従来のIL契約を利用する。

結果は revision / fingerprint / publicationReady=false / paginationDiagnostics と status を含む。placed では layout と、原稿対応を保持する fragments（origin, unitStart, unitEnd, continuationIndex, sourceBreakReason, placement）を返す。sourceBreakReason は既存分割の由来であり、最終ILページ境界を表すものではない。conflict では stage（pagination / intent / layout）と diagnostic を返し、fragments=[]。既存の partial ページ計画を誤って適用しない。GUI は最新 revision の結果のみ表示し、競合時は最後の有効な計画を保持する。

制限: 実測幅を変える再計測、配置中に分割境界を再最適化する処理、複数断片への固定・占有率指定、描画データの移送、既存ブラウザプレビューへの接続、増分・キャッシュ、正式PagePlan/PDFへの統合は未実装。初回の既存分割境界を固定するため、最適な詰め方にならない場合がある。入力は既存の型付き PaginationInput とし、外部JSONは既存の入力検証を経由する。既存の測定器やレンダラーを置換しない。

## IL-07: 増分計算・キャッシュ（実験的）

planIntelligentLayoutIncremental(input, previous?, options?) は成功した配置と不透明なプロセス内 snapshot を返す。入力全体の検証後、本文寸法・gap・予約領域が一致するときだけ、同一ブロックキーの前方範囲を再利用する。後続の同一キー列はページ・行起点・下端・右端・行共有状態がすべて一致した地点から再利用する。追加・削除もキー列と状態が一致すれば対応する。revision は常に現在の入力を返す。キーはID、実測寸法、モード、固定位置、占有制約、明示余白、横並び許可、改ページを含む。出力矩形の変更は保存済み状態に影響しない。競合は全候補を破棄し、新しいsnapshotを発行しない。

希望配置・候補最適化が指定された場合は、全体候補選択が変わり得るため従来の全体計算にフォールバックし、fullRecompute=true（配置作業カウンタは未計測のため0）。通常の配置では reusedBlocks / reusedSuffixBlocks / placedBlocks を返す。これらは配置作業の件数であり、入力検証やコピーの時間を含まない。

planMeasuredIntelligentLayoutIncremental(input, options?, previous?) は既存 paginateMeasuredIncremental と上記ILキャッシュを独立して使用する。原稿ID・現在のorigin・fingerprintを再構築し、既存の断片・警告・競合契約を保つ。成功時のみ新しいsnapshotを発行する。GUIは文書ごとに最後の成功ハンドルを保持し、競合・古いrevisionを採用しない。保存ファイルにsnapshotを書き込まない。

制限: 計測済み入力の増分処理であり、ブラウザ再計測の省略は既存測定器の責務。全入力の検証、キー作成、公開結果の複製は残る。非同期化、候補ごとのチェックポイント、実測性能試験、PagePlan/PDF統合は後続。

## IL-08: 協調計算と最新編集優先プレビュー（実験的）

planIntelligentLayoutIncrementalCooperative と planMeasuredIntelligentLayoutIncrementalCooperative は同期版と同一の生成器を駆動する。検証、キー、再利用、配置、候補評価、snapshot作成、計測済み断片の変換で checkpoint を呼び、呼び出し側がホストに制御を返せる。checkpoint の拒否は処理を中止する。希望配置・候補最適化も中断可能な全体計算となる。入力・オプションは完了まで変更しないこと。

createIntelligentPreviewSession は文書ごとに1個作る。request(input, options) は単調増加 requestId と revision を持ち、次のホストターンまで開始を遅延する。同時に要求された古い仕事は superseded となり、最新の成功だけが内部checkpointを更新する。競合では前回成功状態を維持する。cancel は要求を無効化し、reset は保持snapshotも解放する。GUIは current かつ isCurrent(requestId) かつ現在revision一致の場合のみ結果を採用し、競合時は既存プレビューを維持する。セッションは公開結果にsnapshotを含めない。

既定は約8msの目標スライスと setTimeout(0) によるホストへの譲渡。sliceMs・yieldToHost・now を注入できる。実際の割込み点間の処理時間、JS実行環境、タイマーの遅延に依存するため8msの保証ではない。Workerへの実際の配置、ブラウザ再計測、描画、ドラッグ中の軽量仮表示はGUI側で別途実装する。ドラッグ中の描画はローカルで行い、確定時にrequestを呼ぶこと。性能比較は npm run benchmark:il で100/1000/10000件の中央値と再利用件数を出す（速度閾値は設けない）。

## IL-09A: 既存の実測ブラウザ描画への接続（実験的）

TextPagePreviewOptions.intelligentLayout を明示指定した場合に限り、既存の実測ブロックからILを実行し、projectIntelligentMeasuredPlan で既存 MeasuredPagePlan へ投影する。本文の描画矩形と実測寸法、断片の単位範囲、継続番号、origin、警告を保持。占有矩形・元の分割理由は intelligentLayout の詳細結果に残す。空の中間ページも明示固定ページの指定に合わせて保持し、ブラウザ経路では512ページを上限として超過を拒否する。描画は従来の renderMeasuredPreview のみを使い、追加の折返し・再計測・独立したページ分割を行わない。ILを指定しない従来経路は変更しない。

ILの競合は IntelligentPreviewConflictError（conflict に診断・revision・fingerprint）として返し、描画も新規キャッシュの登録も行わない。createRetainedTextPagePreview は既存のDOM/実測キャッシュとILの増分snapshotを同じページ再利用ハンドルに紐付け、成功時のみ更新する。intelligentPlacementWork はIL側の作業件数、paginationWork は既存分割側の作業件数。配置指定は初回await前に複製する。GUIは最新revisionと要求IDを検証して紙面を採用する。

この投影は実験的な MeasuredPagePlan であり、publicationReady=false を維持する。projectIntelligentMeasuredPlan はエンジンが生成した成功結果専用で、外部JSONの検証器ではない。正式な出版PagePlan、ページ番号・面付け、PDF生成を担うBookCreator側の接続は別作業。固定ページの空白・本文位置をPDFでも同じように扱うには、ホストが同一確定計画を使うことを検証する必要がある。

## IL-09B: 試しPDF用の計画一致ゲート

BookCreator本体の apps/desktop/print-renderer.mjs は createPlainTextPagePreview、assertMatchingPrintPlan、prepareTrialPrint、Electron printToPDF の順で処理する。options.intelligentLayout を保存済みの全冊入力に含めれば既存の印刷画面でも IL を選択できる。試し出力のみで正式出版は許可しない。

追加 API createIntelligentPrintTicket(preview, paper) は全体計画・IL詳細結果・紙面条件の一致を確認し、JSON移送可能な比較レコードを作成する。retained の sparse DOM は使わず、完全な plan メタデータを受け付ける。revision/fingerprint、連続ページ（中間空白を含む）、原稿ID/範囲、全断片の内容座標・分割範囲・継続番号・改ページ理由、警告に加え、ILの占有矩形・固定/希望状態・元の分割理由を比較対象にする。紙面は試しPDFの既存制限30–300mm、512ページ。レコードは暗号学的な署名ではなく、ホストが承認した不変入力の比較専用。

createVerifiedIntelligentPrintPreview(document, options, ticket) は専用印刷Documentで完全な未接続DOMを再生成し、比較レコードの紙面・revision/fingerprint・計画・IL詳細が一致しなければ拒否する。印刷アダプタは既存 prepareTrialPrint にこのDOMを渡し、別の改ページをさせない。inlineMathCache を使用する場合は印刷Documentに属する新規キャッシュをホストが用意し、同じ計測モードを再現する。比較レコードの移送はホストの責務。ユーザー意図、素材、フォント、計測環境の保存と検証、出力中の変更検知、PDF実体の検査、正式FinalizeはBookCreator側の責務。

ここではEngineの接続APIとChromiumでの紙面再生成試験を追加する。別Document・Electron実PDFの実測、文字や描画の忠実性、正式出版は未検証。BookCreator本体のGUI/保存/IPC変更は本体担当との連携で行う。

## IL-09C: BookCreator担当への統合契約

本体側の PAPER-GUI 系の原稿編集・永続ID・保存正本は本体担当が管理する。Engine の変更を固定参照で取り込んだ後、現行原稿の documentId/blockKey に解決した明示意図だけを intelligentLayout に渡す。既存部品が実測寸法に適用済みの占有率を二重に適用しない。原稿編集、意図編集、用紙変更、フォント/画像変更は同じ要求世代を無効化し、計測環境を含む fingerprint を更新する。旧revisionや分割済み原稿ブロックへの曖昧な意図は適用しない。

- 画面: createRetainedTextPagePreview の plan/slices は全体、changedElement は差分のみ。現在の要求IDとrevisionが一致した成功結果のみ採用する。conflict では前の表示を保持し、古い表示で編集/出力を許可しない。文書・フォント環境を変える場合は前回 PageReuseSnapshot を破棄する。
- 保存: snapshot や最適化スコア、計算済み座標は原稿の正本ではない。明示意図は本体スキーマで検証し、削除や重複・ID不明・未保存の状態を拒否する。
- 試しPDF: 承認済み全冊の options.intelligentLayout、paper、plan、IntelligentPrintTicket を同じ不変入力として保持する。print-renderer.mjs は IL が有効な場合 createVerifiedIntelligentPrintPreview を選び、続いて既存 assertMatchingPrintPlan / prepareTrialPrint を使用する。ticketなしのIL出力やILなしのticketは拒否。旧APIの出力は維持する。別Documentにキャッシュを共有しない。
- 本体の保存照合: 現行 trial-pdf-export.mjs の保存済み原稿・テーマ・設定・フォント確認に、保存済みIL意図とそのrevisionも含める。出力処理中の意図変更は旧版として明示するか中止し、無断で確定しない。最終的なPDF構造・位置・内容・フォント検査は本体の責務。

Engine はこの契約と別DocumentでのDOM再生成試験までを提供する。本体の画面、保存、IPC、実Electron PDF出力はこのPRでは変更しない。publicationReady=false のまま維持する。

## IL-10A: 総合品質・性能の自動検証

決定的な擬似乱数で混合ブロックを生成し、固定位置、予約領域、占有率、明示余白、改ページ、読み順、重複/欠落、寸法保存を独立した不変条件で検証する。追加/削除/寸法・制約変更後の増分・協調計算をコールド計算と比較する。計測済み分割の単位範囲を再構成し、断片の欠落や重複がないことを検査する。競合は空結果とsnapshot未発行を確認する。

Core checks に 100/1000/10000 ブロックの benchmark を追加する。配置一致の失敗はCI失敗、実行時間は環境に依存するため情報として記録し、固定ms閾値を設けない。増分計算は全入力検証・キー・出力コピーを含むため、再利用数が多くても必ず高速になるとは限らない。ブラウザの実測・描画・Windows上での入力応答を含む全冊性能は別途検証する。

## IL-10B: キャッシュ管理の負荷削減

IL-10A の Linux CI run 46126756498 は 127/127 テスト成功。中央値（通常/増分、ms）は100件 0.129/0.146、1000件 0.588/1.571、10000件 4.789/4.813。再配置は11/21/21件だが、計算時間の優位性は確認できなかった。ブラウザ計測や描画は含まない。

増分キャッシュのブロックキーを JSON文字列から検証済みのプリミティブタプルへ変更。すべての制約を検証してから再利用し、同じ有効占有寸法の異なる制約表現は同一の幾何として扱う。固定・明示余白・横並び・改ページ・内容寸法はキーに残す。候補最適化と希望指定の全体計算は変更しない。

再利用された非公開の配置値は世代間で共有し、外部へ返す矩形だけを複製する。全キー一致なら非公開snapshot全体を共有する。新規配置は公開値と非公開値を分離する。sharedSnapshotPlacements は再利用した内部配置値の数。保持ハンドルは従来どおりWeakMapで管理し、共有値に変更を加えない。公開結果の可変性と競合時の保護は維持する。

計算時間の改善とメモリ削減量はCIベンチマークで再確認する。ヒープ全体の測定はまだ行っていない。性能を理由に検証を省略しない。

## IL-10C: 長時間編集・保持メモリの検証

IL-10B の Linux CI run 46126953986 は132/132テスト成功。通常/増分中央値（ms）は100件 0.153/0.153、1000件 1.023/0.627、10000件 4.578/2.183。前回と異なるCI実行のため直接の因果測定ではない。10000件で9979件の非公開配置値を共有した。

sharedSnapshotPlacements を計測済みブリッジとセッションの作業指標にも渡す。キャッシュの内部値は外部へ公開しない。長時間編集試験は同じセッションで新規要求、競合、取消、resetを繰り返し、最新の結果と通常計算の一致、revision、公開結果の変更からの隔離、reset後の再計算を確認する。

npm run benchmark:il:session は Node --expose-gc を使い、1000/9999件の計測済みブロックを80/24回局所編集する。9999は既存ページ分割snapshotの上限10000イベントに1セクションを含めるため。実際のホスト譲渡を使用するセッションの経過時間中央値・p95、再利用件数、明示GC後のプロセスheapUsed（初期、ウォーム、途中、最終、reset後）を記録する。旧公開結果は保持しない。通常計算との定期比較に失敗すればCI失敗。heapUsedはV8全体の観測値でありIL専用のバイト数やリークなしの証明ではないため、固定閾値による合否判定をしない。ブラウザDOM、素材、フォント、実PDF、Windowsの実操作は対象外。正式出版は未許可。

## IL-09C補完: 実Chromium PDFの受入試験

IL-10C の Linux CI run 46127066887 は135/135テスト成功。実ホスト譲渡付きセッションの中央値/p95は1000件 3.37/7.61ms、9999件 26.74/51.84ms。GC後heapUsedは1000件で初回5.88MB・終了6.37MB・reset後5.56MB、9999件で13.10MB・12.83MB・4.84MB。単一実行の観測であり、リークなしやGUI応答の保証ではない。

実PDFの検証を独立したChromiumテストに追加。別Documentで作ったILチケットから印刷用DOMを再生成し、本体の試し印刷スタイルと同様のテスト専用投影を用いる。CDP Page.printToPDFで実PDFを一時生成し、Poppler pdftotext -bboxで実ページ数、用紙寸法、空白ページ、英字マーカーの欠落/重複/ページ所属、座標と包含を独立検査する。座標・寸法の許容差は1mm。左右余白の反転、横並び・占有領域、固定ページをfixtureに含む。CIに組み込み、PDFは一時ディレクトリで破棄する。

これは固定fixtureのLinux Chromium試験であり、BookCreator本体の印刷アダプタ実装、IPC・保存、Windows Electron、全数式/画像/日本語/フォントの忠実性を保証しない。正式出版のゲートは変更しない。本体担当の進行中PAPER-GUIと競合しないようEngineの試験のみ追加する。

## IL-09C補完: 日本語・数式・画像の実PDF試験

PR #85 の実PDF CI run 46127318350 は4ページ、3ページ目空白、英字4件の位置・寸法・欠落検査に成功。英字の開始x座標の最大誤差は約0.0034mm。

混合fixtureを追加。Noto CJKをLinux CIへ導入し、日本語見出し・図の説明の文字抽出と日本語フォント埋め込み、番号付き分数の番号抽出と中央領域のインク、2色PNGの所定領域の色・空白ページの白画素を検査する。別Documentでのチケット一致、固定ページ、最低占有高さ、既存印刷投影を維持。PDFをPopplerで144dpiのPPMに変換し、色領域とインクを独立検査する。文字・数式の全字形や画像の一般的な忠実性、Windows実機、本体IPC/保存・正式出版は対象外。CI結果未確認。

## IL本体受入: モード切替・印刷ディスパッチ

PR #86 Linux CI run 46127676639 は日本語抽出・Noto CJK埋め込み・分数と番号・空白ページ・画像の検査に成功。赤6084/6084、青6162/6162のサンプル領域で色条件を満たした。画像全画素・全字形の同一性の証明ではない。

BookCreator #250 の paper-area-preview.mjs は保存済み永続IDを現行ブロックに解決し、明示opt-inで options.intelligentLayout を作る。Engine側は本体の保存形式を変更しない。createTrialPrintPreviewForLayout(document, options, ticket?) を印刷用の単一入口として追加する。ILなし・ticketなしは従来描画、ILあり・ticketありは createVerifiedIntelligentPrintPreview。片方だけ指定された場合は拒否し、ILの失敗時に通常描画へフォールバックしない。ホストは保存済み入力・資源・fingerprint・expectedPlan・出力中の変更を引き続き検証する。正式出版には使用しない。

受入試験: 同じページleaseを使って通常→IL→通常→ILと切り替え、占有率を適用/解除し、各結果をcold計算と比較する。旧モードの組版snapshotを再利用しない。同一ILのsparse retained結果から完全印刷DOMを再生成する。チケットなしIL、ILなしチケット、旧fingerprint、占有高さ変更、内容矩形は同じだが占有幅だけ異なるケースを拒否する。

本体担当への残りの受入条件: Engine固定参照更新、全冊の保存済みIL意図と同一revision/fingerprintでチケット生成・IPC移送、印刷専用Documentで上記入口を使用、既存assertMatchingPrintPlan/prepareTrialPrintを維持、出力前後の保存済み意図照合、ILなし経路の回帰、実Electron/WindowsのPDF検査。現在の本体 #250 はILのPDFを拒否しており、これらの条件が満たされるまでは拒否を維持する。本体コードはこのPRで変更しない。

## IL本体受入: IPC前の計画照合

assertIntelligentPrintTicketMatchesPlan(ticket, expectedPlan, paper) はブラウザやDOMを必要としない共通入口。ホストは保存済み原稿・明示意図・素材・フォントから確定した全冊の expectedPlan と paper を用い、IPC送信前または受信時に JSON/structured clone されたチケットを照合できる。schemaVersion、publicationReady=false、revision、fingerprint、紙面と完全計画の署名を照合し、不一致・部分計画を拒否する。型ガードとしても利用できる。印刷側の既存入口も同じチケットヘッダー検証を使用する。

これは計画のみの事前検査であり、占有領域の違い（内容矩形が同じ場合を含む）、原稿・素材・フォントの同一性、出力中の変更、PDF実体は検証しない。必ず createTrialPrintPreviewForLayout で再計測後の layoutSignature を比較し、本体側の保存照合とPDF検証を維持する。#87 の Core checks / Browser measurement smoke test は成功し、main にマージ済み。本体コードは変更しない。

## IL本体受入: 全冊のIPC移送から実PDFまでの回帰

#88 Core checks / Browser measurement smoke test は成功、mainにマージ済み。本体 #250 の現行印刷側は未接続ILを明示的に拒否しているため、その拒否は維持する。

既存の英字・混合実PDF fixtureを、本体と同じsections形式に変更。英字fixtureは2文書の明示章改ページ、永続ID、横並びと固定ページを含む。混合fixtureも永続ID付きsections形式とし、画像リゾルバ関数はJSON移送せず印刷Document側に再注入する。別Documentでretained previewを2回生成し、全ページ再利用時の完全planとチケット・optionsをJSON往復させる。DOM非依存事前照合、欠落チケット・誤モード・改変チケット拒否、印刷ディスパッチ、確定planとの比較を経て実PDFを生成する。PDFの位置検査基準は印刷側結果ではなく移送された承認済みplanから作る。

これはLinux Chromiumの本体形式に近い受入試験であり、実Electron IPC・保存照合・Windows実機・正式出版の代替ではない。本体コード変更なし。CI未確認。

## IL本体受入: Windows CIの追加

#89のLinux CI run 46128193968 は全冊JSON移送後の英字・混合実PDF試験に成功。4ページ、3ページ目空白、英字4件の位置とページ所属、日本語・数式・画像の独立検査に合格。mainへ統合済み。

Windows runnerでもNode 22型検査と全単体試験を行い、ChromeとPopplerを用いて同じ英字4ページの実PDF受入試験を実行する独立workflowを追加する。Windowsの改行を許容するDevToolsポート読み取りと、試験専用Chromeプロセスツリーの終了・プロファイル削除を調整。Popplerのインストール・実行失敗を成功扱いしない。既存Linux混合試験は維持する。

Windowsの日本語フォント・混合PDF検査は今回追加しない。Windows CIの結果は未確認であり、本体Electronでの実際の保存・IPC・GUI操作・PDF出力や利用者のWindows実機での検証を代替しない。正式出版は未許可。本体コードは変更しない。

## IL本体受入: 未対応の配置意図の拒否

#90 Windows CI run 46128395661 は単体試験136/136、英字4ページの実PDF試験に成功。Linuxの2系統も成功しmainに統合済み。Windowsの日本語・数式・画像混合試験と本体Electronは未検証。

計測済みILのoptions、intent、placement、fixed/preferred座標、sizeConstraintsに未対応のキーが含まれる場合は IL_MEASURED_INTENT として拒否する。対象原稿が特定できる場合はblockIdを返す。誤記した占有率や明示余白を無視して自動配置することを防ぐ。ホスト独自のメタデータはこれらのオブジェクトから分離すること。既知の型付き入力の挙動は変えない。通常・増分・協調経路で同じ拒否を行い、新規snapshotを発行しない。従来の成功snapshotは有効なまま。予約領域・最適化オプションの内部形状については従来の検証契約を維持する。

## IL本体受入: 独立した完全紙面の増分プレビュー

createFullRetainedTextPagePreview(document, options, previous?, checkpoint?) は通常の独立したDOMを毎回完全に返しながら、既存retained計測・組版・IL配置checkpointを再利用する。戻り値はelement/plan/slices/snapshotと各作業カウンタ。差分DOMの再構成・前回DOMの保有は不要。前回紙面を消費しないため、BookCreator #254 の未確定リサイズ提案のような表示に利用できる。提案専用snapshotを保持し、対象変更、取消、フォント/Document変更で破棄する。最新要求の成功結果のみ採用し、確定保存・印刷に未確定案を渡さない。既存のsparse APIは従来契約のまま。

占有率のみの変更で4件の測定を再利用すること、ILの前方再利用、cold計算とのplan/DOM一致、全3ページ（空白ページを含む）の再描画、取消・別Document拒否をブラウザで検査する。全DOMは再生成するため描画負荷は残り、実際の速度改善量は本体計測で確認する。CI未確認。本体コード変更なし。

## 組版への統合（正式出版経路は未実装）

既存測定・分割・増分組版を活用し、ロックや手動余白、明示改ページを制約として扱う。ユーザーが許可した範囲のみ再計測・配置し、不要な全冊再組版を避ける。異なるページへ移動する提案や競合解消はプレビューで明示する。最終的にGUIとPDFは同じ検証済みPagePlanを使用する。

受入: 固定維持、意図的余白維持、重複/欠落なし、読み順維持、Undo/Redo、再読込、旧revision拒否、日本語IME、ドラッグの応答、PDFとの一致。IL-01の単体テストは追加済み、実行結果はCIで確認する。
