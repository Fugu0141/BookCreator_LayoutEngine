# IL-12D: GUI multi-selection group proposal

BookCreator #267 では固定競合時の明示解除を開発中。グループ化はその後の独立したGUI操作とし、保存済み固定位置を自動解除しない。

`proposeIntelligentGroup(result, options, expected, selection)` は完全な成功済みIL計画と、その計画を生成した正確なoptions、revision/fingerprint、明示選択を受け取る。selection は groupId（未使用）、layout（vertical / rows / adaptiveRows）、members（documentId/blockKey の配列）。結果は proposed（独立コピーのoptionsと原稿順members）または rejected（理由コード）。

同一原稿内の連続した2件以上の単一断片のみを対象とする。選択順で原稿を並べ替えない。分割・重複・不明ID、章またぎ、内部明示改ページ、既存グループ、固定/希望位置、縦配置と既存横並び許可の競合を拒否する。自然改ページをまたぐ選択は許可する。rows/adaptiveRows の明示選択は未指定のsideBySideのみtrueにし、既存falseを維持する。占有率、前後余白、他ブロックの意図を保つ。

これは構造上の提案であって配置成功・保存許可ではない。GUIは最新要求の世代、永続ID、保存リースを別途照合し、提案optionsで全冊再計測して競合なしの場合のみ確定可能にする。元optionsは変更しない。グループ解除、永続化、複数原稿のグループ化、実Electron GUIは今回対象外。

通常/増分/協調経路、自然改ページと過大グループの拒否、JSON往復、選択順と原稿順の分離、制約保持の回帰試験を追加。CI未確認。

## IL-12E: Existing-group editing

#104 Core checks / Browser measurement smoke test / IL Windows acceptance 全成功・main統合済み。本体 #268 は全冊の現在位置固定/明示解除を実装中。グループ編集も同じ未確定提案→再計測→明示確定の流れに接続する。

`proposeIntelligentGroupEdit(result, options, expected, edit)` は既存 groupId と全members、action（ungroup / vertical / rows / adaptiveRows）を受け取る。成功済み計画・revision/fingerprint、全メンバー一致、同一原稿・連続・単一断片・同一ページを検査する。部分解除、位置意図や内部改ページとの矛盾、他グループ、旧計画を拒否する。

既存占有率・前後余白・他の意図を保つ。ungroup はグループ関連2フィールドだけを除去し、空のintentのみ除去する。横並び許可も既定で維持する。縦配置への切替には既存trueの明示解除が必要で、edit.clearHorizontal に対象の正確なsourceを渡す。falseを解除することは拒否する。グループ作成時に付与したtrueか元からあったtrueかはEngineのoptionsだけでは識別できないため、GUIが意図の出所を保存するかユーザーに確認する。rowモードへの切替は未指定のみtrueにする。

本APIは正常計画からの編集専用。競合中のグループ復旧、永続化、Undo/Redo、実機GUIは別途。ホストは正確な要求optionsと世代・永続ID・保存リースの確認を続け、全冊再計測が成功したものだけ確定する。通常/増分/協調/JSON往復、元設定への復帰、部分・不正解除拒否を回帰試験に追加。CI未確認。

## IL-12F: Group conflict recovery and placement impact

#105 全3系統CI成功・main統合済み。本体 #269 の同一ページ内固定ドラッグと将来の複数選択操作に対応する。

`findIntelligentGroupConflictTarget(result, options, expected)` は計測済み失敗の診断対象と明示intentが一意に一致する場合、同一原稿のgroupIdと全membersを返す。分割・欠落・内部改ページ・過大グループ等を含む。一般組版エラー、旧revision/fingerprint、重複intent、章またぎ、対象不明はundefined。原因がグループだけであることや解除後の成立は保証しない。

`proposeIntelligentGroupRecovery(result, options, expected, selection)` は明示された全メンバーが失敗時のグループと完全一致する場合だけ、groupId/グループlayoutの2フィールドを除いた独立optionsを返す。横並び許可・禁止、固定、希望、占有率、余白等は変更しない。空intentだけ除く。成功紙面を必要としないが、解除後も失敗する可能性がある（例: 分割ブロックに個別占有率が残る）。ホストは明示確認・保存済み永続IDとリース・世代・失敗時optionsの完全一致を検証し、復旧提案を再計測する。無断解除・保存は行わない。

`compareIntelligentPlacementImpact(before, after, expected)` は同一revision/fingerprint、同じ順序・断片ID・原稿revision/範囲/永続ID・unit範囲の成功済みIL計画同士を比較する。移動断片数、ページ変更断片数、各変更の前後geometryと固定/希望結果・内容寸法・占有寸法の変化を返す。ページをまたぐ移動は物理ページindexで判定し、本文相対座標とは区別する。分割再構成や本文変更の比較は対象外。計数は断片単位であり、原稿ブロック単位ではない。要求世代の検証はホスト側で行う。表示用であって保存許可ではない。

通常/増分/協調、JSON往復、過大・分割・内部改ページ、他固定/余白/占有維持、差分の独立性を回帰試験に追加。本体コード・実機操作・永続化は今回変更しない。CI未確認。

## IL-12G: Full-book edit cycle acceptance

#106 全3系統CI成功・main統合済み。本体 #270 は希望位置と横縦許容幅を保存・履歴・復旧経路に接続する段階。既存の実ブラウザ試験に2原稿4ブロックの編集サイクルを追加する。

成功した完全retained紙面から複数選択をグループ化し、影響比較で移動を検出する。希望座標と実測座標が異なるドラッグ案を生成し、案の破棄・描画中のcheckpoint取消・別章固定位置の競合で確定DOMと履歴が変わらないことを検査。明示確定時には実測座標ではなく元の希望座標と許容範囲をJSON履歴に保存する。Undo/Redoで設定を再計測し、同一計画と希望結果を復元。グループ解除とそのUndoを含む。全有効案について計測4件再利用、cold計算一致、他章の固定位置維持を要求する。

最終確定紙面から試行印刷ticketを生成し、独立Documentで同一計画を再現する。異なるグループ解除案のticket流用は拒否する。元optionsと成功DOMは破壊しない。

履歴・確定操作は試験内のホスト模擬であり、本体のUndo/Redo、永続化、IPC、競合時の保存リース、実Electron操作や実PDF出力を代替しない。今回の変更はブラウザ回帰試験と仕様のみ。既存のLinux/Windows実PDF試験は維持する。CI未確認。
