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
