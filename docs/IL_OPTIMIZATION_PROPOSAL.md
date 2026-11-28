# IL-15C: 確認用の自動配置改善案

`proposeIntelligentOptimization(input, approved, options, goal)` は計測済み入力と現在の成功計画から、指定した目的の改善案を1件生成する同期API。compact は既存の候補探索と部分希望再試行を有効化し、balance はページ深さバランスを有効化する。既存の設定・intents・予約領域は複製し、原稿・入力・保存済み配置は変更しない。明示的に選択した目的のフラグだけを有効にする。

最初に同一設定で計画を再計算し、承認済み計画と完全なJSON比較を行う。これは計画の一致確認であり、異なる入力が同じ計画を生む場合の識別や保存リースの代替ではない。呼出元は元の入力・設定・リソース・世代が同一であることを別途保証する。JSONのフィールド順も比較に含まれるためエンジン生成結果またはそのJSONコピーを用いる。

改善候補では断片ID・範囲・寸法・占有寸法を維持し、固定位置、個々の実現済み希望、ページ数、空白ページ数、分割警告数、既存の同一ページペア評価を悪化させない。ページ削減・希望実現数増加、またはbalanceでの隣接ページ深さ偏り削減があり、実際の配置変化がある場合だけ提案する。空白・固定・希望・予約領域を含むページと明示境界は偏り評価から除外する。全体最適性や目視品質を保証しない。

成功時は候補設定、計画、前後の品質レポート、移動部品一覧、改善値を返す。失敗時は stale / invalid-goal / conflict / unsafe-change / no-improvement のいずれかを返す。自動適用・保存・印刷を行わない。GUIで改善値と影響箇所を提示し、明示承認後に同一設定で独立した実測プレビューと保存時検証を行う。取消では候補を破棄するだけ。再計算を含むため毎フレームのドラッグには使わない。

ページ削減、偏り削減、固定を維持した希望回復、旧計画・同一revisionの設定不一致・無改善・無効目的の拒否、元データ非変更の試験を追加。CI・本体接続・実機速度は未確認。

## IL-15D: 改善案の単回確認ハンドル

prepareIntelligentOptimizationReview は既存提案APIを使い、成功した提案と同時に非永続のopaque handleを返す。内部WeakMapに元の計測入力・計画・設定のJSONとhost lease、候補の独立コピーを保持する。GUI表示用の候補を編集しても内部候補は変化しない。

cancelIntelligentOptimizationReview はhandleを無効化する。confirmIntelligentOptimizationReview は現在のhost lease・元入力・元計画・元設定、および独立した完全実測プレビューの候補設定・計画がすべて一致する場合のみ、確認済み設定/計画のコピーを返す。不一致を含めて一度の確認でhandleを消費する。JSONコピーや別handleでは確認できない。host leaseの正しさは呼出元が保証し、保存直前の独立検証を省略しない。

hostは確認成功後にのみ、既存の保存・Undo/Redo履歴へ設定を取り込み、印刷ticketを確定紙面から新規発行する。取消時は候補を破棄する。履歴・保存・印刷そのものはこのAPIでは行わない。分割範囲や意味情報の変更時は新しい入力とleaseで再提案する。単回利用・取消・古いlease・入力/計画/設定変更・候補改変・プレビュー不一致の回帰を追加。CI・本体接続未確認。

## IL-15E: 配置改善案の説明

describeIntelligentOptimizationProposal は成功提案の目的、選択候補名、ページ削減・希望実現数増加・占有下端偏り削減の正の改善値と、移動した原稿ID/部品ID/断片範囲、前後ページ、本文相対X/Y差、希望回復フラグを返す。失敗提案は undefined。ページ番号は0始まり、距離は整数µm。戻り値の変更は元提案に影響しない。

候補の評価は紙面全体を比較するため、個別の移動が特定の改善を引き起こしたとは断定しない（causalAttribution:false）。GUIは全体の改善目的と観測された部品ごとの差分を分けて提示する。元提案の表示専用で、承認handle・host lease・保存時検証を置き換えない。compact/balanceの改善値、正確な移動差分、表示の独立性、拒否結果の試験を追加。CI・GUI接続未確認。

## IL-16A: 改善対象ページ範囲と移動予算

proposeIntelligentOptimization の任意の第5引数、prepareIntelligentOptimizationReview の任意の第6引数に `IntelligentOptimizationScope {firstPage,lastPage,maxMovedFragments?}` を追加する。現在の承認済み全冊計画の0始まりの両端を含むページ範囲を指定し、範囲外に出入りする断片、範囲外の配置・希望状態等の変更、範囲外の末尾ページ削除を拒否する。maxMovedFragments は位置またはページが変わる断片の上限（0〜10000、未指定は制限なし）。不正範囲、範囲外、移動数超過は invalid-scope / outside-scope / movement-budget を返す。未指定の場合は既存動作を維持する。

範囲は一時的なレビュー条件であり、保存済み固定/希望/グループや最適化設定に追加しない。成功提案に範囲のコピーを返し、確認handle内部の候補は独立して保持する。GUIで対象範囲を変更した場合は旧handleを取消し、新しいhost leaseで再提案する。範囲を指定しても全冊計算から得た候補を検査するため、範囲内だけを探索する局所最適化ではない。範囲を守る別候補が存在しても現在の候補を拒否することがある。将来の原稿変更や再組版まで範囲外の位置を保証するものではない。承認時・保存時の独立検証を維持する。

無関係な章を維持する改善、範囲の内外をまたぐ移動拒否、移動数上限、無効範囲、範囲のコピー・レビュー確認、22ページの計測fixtureで20ページの完全一致を回帰試験に追加。CI・GUI接続・実機未確認。

## IL-16B: 指定ページ内のバランス候補探索

#125 全3系統CI成功・main統合済み。balance目標でscopeがある場合、optimization.balancePageRange に0始まり両端を含むページ範囲を追加し、その内部の隣接ページ境界だけを占有下端偏りの評価・移動候補生成に使用する。全冊で最も改善幅が大きい境界が範囲外でも、範囲内の候補を探索する。compactは従来の範囲ガードのみ。未指定時は既存の全冊バランス候補と評価を維持する。不正範囲やbalancePageDepths:trueなしの指定はIL_INVALID。意味ヒントとの併用を維持する。

候補設定はJSON化可能で、承認後の独立実測・保存検証・印刷で同一のbalancePageRangeを用いる。これは永続的な固定位置や章IDではないため、原稿改変後の範囲をhost側で見直す。範囲外への変更・移動数超過を拒否する#125の受入ガードを維持する。実際の配置は全冊の合法性を再計算し、範囲内だけの増分計算・複数境界の組合せ探索は未実装。

2組の隣接ページで範囲外の改善幅がより大きい場合に対象範囲の候補を選び、後続2ページを維持する試験、無効範囲、意味ヒント併用、JSON再計算とreview一致を追加。範囲に適格境界がない場合はno-improvementになり得る。CI・本体接続・実機性能未確認。

## IL-16C: 指定範囲バランス候補の配置計算再利用

#126 全3系統CI成功・main統合済み。balancePageRange を指定した最適化では、既存の候補探索中に成功した希望尊重lookahead passの内部checkpointを保持し、追加のpage-balance候補（内部改ページヒント1件）を同一方式で試すときだけ使用する。変更直前のlookahead依存を1ブロック戻して再計算し、グループ内は原子的に戻す。後続はキー列と完全なflow stateが一致した地点から再利用する。checkpointの互換性に希望尊重/無視ID/lookaheadを含め、別方式と混用しない。先行passが失敗した場合は従来の完全計算。未指定時は従来動作を維持する。

最適化reportの任意 targetedBalanceWork は追加候補の配置作業数（reusedBlocks/reusedSuffixBlocks/placedBlocks）で、候補が選ばれたことや全処理時間を示すものではない。全冊の検証・キー走査・コピー・評価と、最初のgreedy/lookahead等は継続する。候補をまたぐ内部再利用のみであり、異なる編集要求や原稿改変をまたぐ最適化snapshotの再利用は未実装。102ページ104ブロックfixtureで95以上の再利用と49以上の後続再利用、前後ページ不変、完全候補との幾何一致を検査する。横並びlookaheadとadaptiveRowsグループの前置ケースも追加。実行時間の実測・CI・GUI接続未確認。

## IL-16D: 指定範囲最適化の編集要求間再利用

balancePageRange 指定時の増分APIで、成功済み希望尊重lookahead passのcheckpointを別の編集要求に引き継ぐ。通常greedy snapshotとは別の内部WeakMapに保持し、既存の互換context、正規化キー、lookahead依存、グループ境界、flow state一致で再利用範囲を決定する。範囲変更や評価条件変更でも基礎lookahead配置が同じなら再利用可能。候補選択・評価・全冊検証は毎回実行する。キャンセルや失敗で旧snapshotを変更しない。通常/他の最適化方式のsnapshotとの混用は行わない。

増分APIのplacement作業数はこの主lookahead passについて報告し、greedy・追加候補・キー走査・コピー・評価等の全処理時間を表さない。追加balance候補のtargetedBalanceWorkは従来通り別計測。成功結果はcold計算と完全一致する必要がある。102ページ104ブロックの局所編集、範囲変更、協調処理と取消、用紙変更、通常方式とのsnapshot分離を回帰試験に追加。CI・実機速度・GUI接続未確認。

## IL-16E: 長冊の範囲指定最適化ベンチマーク

#128 全3系統CI成功・main統合済み。npm run benchmark:il:targeted で240ページ/480ブロックおよび1000ページ/2000ブロックの合成計測済み書籍を比較する。中央章の高さ変更と範囲のみ変更の2シナリオ、それぞれ4回ウォームアップ・16組のペア測定。同一入力・同一設定でcoldと前回snapshotを引き継ぐincrementalを交互の実行順で比較する。

各ペアで完全な結果一致、成功、ページ数、選択候補、主lookaheadと追加候補の再利用件数を必須検証する。局所編集では全ブロックから9個を引いた数以上、範囲のみ変更では主lookahead全件の再利用を要求。IL_TARGETED_BENCH のJSONで中央値/p95/最小/最大・中央値比、作業数と全ペア値を出力する。時間閾値は設けず、増分処理が遅い場合も結果をそのまま報告する。Core CIに追加した。計測済み入力からの処理時間であり、フォント/DOM/Electron/実機操作/PDF出力は含まない。1000ページはcore solverの合成負荷試験であって、ブラウザプレビューの上限変更ではない。CI結果・実測値未確認。

## IL-16E 実測結果と実用機能への移行

#129 Core CI run 46141290227（各16ペア、単位ms）: 240ページ局所編集 cold 2.383 / incremental 1.967、範囲変更 2.168 / 3.646。1000ページ局所編集 4.409 / 5.408、範囲変更 4.312 / 5.213。局所編集の主lookahead再利用最小値は476/480、1996/2000。全結果一致と作業数条件に合格。増分は必ずしも高速ではない。p95は順に cold 5.174/4.875/4.998/6.367、incremental 6.272/4.369/12.519/8.097。計測済みsolverの合成負荷でありGUI速度の保証ではない。追加の微細な高速化よりも実用接続を優先する。

## IL-17A: retained紙面から改善案を確認するブラウザ接続

prepareRetainedIntelligentOptimizationReview(document,base,goal,lease,scope?) は成功済みretained IL紙面のsnapshotに紐づく内部計測入力・元設定・元計画を使用する。hostがPaginationInputを再構築したりmutable計画を渡したりする必要がない。戻り値の提案設定でcreateFullRetainedTextPagePreviewを実行し、実際に生成されたcandidate snapshotをconfirmRetainedIntelligentOptimizationReview(document,handle,base,candidate,lease)へ渡す。取消はcancelRetainedIntelligentOptimizationReview。元snapshotの同一性・Document所有権・候補の実測入力一致・元lease・候補設定/計画一致を検証し、単回消費する。元紙面の変更や自動保存は行わない。

hostは原稿/フォント/画像/用紙/測定環境の同一性、最新世代、完全な表示紙面、保存直前の再検証、Undo/Redo、印刷ticketを引き続き管理する。内部計測入力一致は資源バイトや原稿内容の完全認証ではない。retained snapshotへ設定/計画の独立コピーを保持するため追加メモリ・コピー費用がある。ブラウザ回帰に候補描画、計測再利用、承認・取消・旧lease/別base/別Document/変更入力拒否、表示改変隔離、独立印刷DOM一致を追加。CI・本体接続・実機速度未確認。

## IL-17B: retained紙面の診断と原稿単位の改善範囲

#130 全3系統CI成功・main統合済み。inspectRetainedIntelligentLayoutQuality(document,base) は成功済みretained IL紙面の非公開計測・計画から品質診断と原稿ごとの実配置ページ範囲を返す。原稿IDで集約し、同じblockKeyを持つ別原稿を混同しない。ページは0始まり。範囲内に別原稿の断片が存在するページをmixedPagesに列挙し、そのようなページが1つでもあればexclusiveScopeを返さない。間の空白ページは許容する。原稿を選ぶだけで他の原稿が置かれたページを改善対象にしないための保守的な判定であり、共有ページの編集禁止や永続固定ではない。GUIでは範囲を表示し、ユーザーが明示的に選択した場合にprepareRetainedIntelligentOptimizationReviewのscopeとして渡す。

別Document/無効handleは従来通り拒否、非IL retainedはundefined。返却値の変更は内部状態に影響せず、再計算・再測定・保存は行わない。hostの最新世代・原稿/資源の確認は必要。共有ページ、独立原稿、同名部品、固定位置による空白ページ、結果改変の隔離、別Document、非ILをブラウザ回帰で検査。CI・本体接続未確認。

## IL-17C: 原稿選択からの安全な改善案生成

#131 全3系統CI成功・main統合済み。prepareRetainedIntelligentDocumentOptimizationReview(document,base,documentId,goal,lease,maxMovedFragments?) を追加。GUIは選択した原稿IDを渡し、非公開の実測配置から排他的ページ範囲を再取得する。表示用診断の改変や古い表示範囲を入力として使わない。原稿なしはunknown-document、共有ページを含む範囲はshared-pages、非ILはstaleで拒否し、全冊改善にフォールバックしない。共有ページを対象とする場合はユーザーが明示したページ範囲で従来のprepareRetainedIntelligentOptimizationReviewを呼ぶ。

範囲内外の移動制限とmaxMovedFragmentsの検証、確認・取消・実際の候補紙面との照合は既存APIを再利用する。範囲集約は断片の列挙順序によらず最小・最大ページを使用する。回帰試験では共有/不明原稿、非IL、別Document、移動予算、表示診断の改変、明示範囲案との一致、確認・取消を検証する。hostの最新世代・資源・保存/履歴検証は引き続き必要。CI、本体GUI接続、実機操作は未確認。

## IL-17D: 改善案の紙面差分をGUIへ提供

inspectRetainedIntelligentOptimizationReview(document,handle,base,lease) は有効なretained reviewの非公開候補から、改善前後の総ページ数、移動・ページ変更断片数、改善理由、対象範囲、変更断片の完全な前後配置、影響ページの前後品質と出入りの断片IDを返す。座標は本文領域基準の整数µm、ページは0始まり。ページ単位の品質値が同じでも断片変更があれば含め、追加/削除ページの存在しない側は省略する。全体評価から個々の移動の因果は推定しない。変更のないページは除外する。

元base・Document・leaseを検証し、取消済み/消費済みのhandleはundefined。誤った参照による照会はhandleを消費しない。返却値は独立コピーで、公開proposalの改変にも影響されない。照会は再配置・測定・描画・保存を行わず、候補紙面の実測確認やhostの世代検証を代替しない。ブラウザ回帰で前後座標、ページ対応、公開データの隔離、別base/Document/lease、取消・確認後の無効化を検証する。CI・GUI接続・実機未確認。

## IL-17E: 改善候補の明示選択

prepareRetainedIntelligentOptimizationChoices(document,base,target,lease) は同一の承認済み実測紙面からcompactとbalanceを独立に生成する。targetは明示的なbook、pages(scope)、document(documentId,maxMovedFragments?)のいずれか。欠落/不正targetはinvalid-targetで拒否し、原稿の共有ページや不明IDを全冊対象に広げない。各候補はavailable(比較情報)またはrejected(既存拒否理由)。全案拒否時はemptyでhandleなし。候補間の自動順位付け、第三の目的関数、同時最適化は行わない。compactは既存の選択的希望位置復帰方式で、必ずページ数を削減するものではない。

selectRetainedIntelligentOptimizationChoice(document,handle,base,lease,goal) は同一base/Document/leaseの有効候補を一度だけ通常のreviewとして移譲し、他候補を取消す。候補一覧に個別review handleを公開しない。誤選択は集合を消費せず、cancelRetainedIntelligentOptimizationChoicesで全候補を破棄可能。選択後は従来の候補実測描画・confirm/cancelを使用し、選択自体は描画・保存・印刷を許可しない。hostは世代変更時に集合/移譲済みreviewを破棄する。各目的ごとに既存solverを呼ぶため最大2回分の提案計算費用がある。回帰試験は範囲誤指定、共有原稿、予算、不採用理由、表示改変、lease/Document、単回選択、取消、実測候補確認を対象とする。CI・GUI接続・実機速度未確認。

## IL-17F: 改善候補生成の協調処理

prepareRetainedIntelligentOptimizationChoicesCooperative(document,base,target,lease,checkpoint,signal?) を追加。同期版と同一の提案判定を共有し、既存の協調測定済み組版APIとretained placement checkpointを使用する。呼出時に対象を独立コピーし、各目的と処理段階をcheckpoint(goal,stage)へ通知する。hostが必要な頻度で実タスクへyieldすることで入力処理に制御を返せる。AbortSignalによる取消はAbortError、host checkpointの例外はそのまま伝播し、生成済みの未公開reviewを破棄する。途中の候補集合は公開しない。返却後の取消は既存の集合/単一review取消APIを使う。

hostは最新要求への切替時に旧AbortControllerをabortし、返却直前後の世代確認と古い集合の破棄を行う。自動世代管理や保存許可は提供しない。品質集計・比較・コピー等の同期区間は残り、実機の応答時間は未測定。ブラウザ回帰で同期版との一致、呼出後の対象改変、実タスクyield、solver内取消、開始前取消、checkpoint例外、再試行、実測候補確認を追加。CI・GUI接続・実機速度未確認。
