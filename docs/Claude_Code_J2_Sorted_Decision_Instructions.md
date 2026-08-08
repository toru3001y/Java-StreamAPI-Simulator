# ローカルClaude Code向け J-2 `sorted`仕様確定指示

以下を、そのまま対象リポジトリのプロジェクトルートで起動したClaude Codeへ渡してください。

---

# Java Stream API 可視化シミュレーター J-2 `sorted`仕様確定指示

## 1. 今回の目的

Phase 2は正式承認され、GitHubの`main`へマージ済みです。

今回行うのは、Draft v0.8の持越し事項J-2のうち、Phase 3着手前に期限が設定されている
`sorted`の「一括並べ替え確定snapshot」と「1つの確定snapshotに処理中要素は原則1件」の関係を確定し、
判断記録へ残すことです。

**これはPhase 3の実装開始指示ではありません。**

`distinct`、`sorted`、`limit`、`skip`、`takeWhile`、`dropWhile`、`peek`のDomain実装、
OperationCatalog登録、DSL追加、Step Engine変更、React UI変更、fixture・テスト追加は行わないでください。

## 2. 作業ブランチ

### 2.1 使用するブランチ

`phase-2`は正式承認・統合済みの履歴なので、今回の変更を追加しないでください。
`main`へも直接変更しないでください。

最新のcleanな`main`から`phase-3`ブランチを作成し、その最初の作業としてJ-2を確定してください。

2026-08-08時点で確認済みのPhase 2統合コミットは次です。

```text
0185e64f0e673546c2a3bcacb4472c4bc1fc492b
Merge pull request #2 from toru3001y/phase-2
```

作業前に次を実行してください。

```bash
git fetch origin
git switch main
git pull --ff-only
git merge-base --is-ancestor 0185e64f0e673546c2a3bcacb4472c4bc1fc492b HEAD
git status --short
git branch --list phase-3
```

確認事項は次のとおりです。

- `git merge-base --is-ancestor`がexit 0であること。
- worktreeがcleanであること。
- `main`がPhase 2統合コミット自身、またはその子孫であること。
- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`が存在すること。
- `docs/phase-2-decisions.md`と`docs/phase-2-completion-report.md`が存在すること。

ローカルに`phase-3`が存在しない場合だけ、次を実行してください。

```bash
git switch -c phase-3
```

すでに`phase-3`が存在する場合は、削除、reset、上書きをしないでください。ブランチを切り替えたうえで、
最新`main`がその祖先であり、worktreeがcleanであることを確認してください。条件を満たさない場合は停止して報告してください。

本指示だけを根拠にcommit、push、Pull Request作成、`main`へのmergeは行わないでください。

## 3. 判断時に使用する基準

優先順位は次のとおりです。

1. `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`
2. 本指示
3. `docs/phase-2-decisions.md`
4. `docs/phase-2-completion-report.md`
5. 現在の`main`上のSnapshot・Step Engine・UI契約

Draft v0.8では、少なくとも次を確認してください。

- §12.5：`sorted`の操作固有状態はbuffer、並べ替え済み順序、放出位置
- §12.6：1つの確定snapshotに処理中要素は原則1件
- §13.1：`sorted`の蓄積、並べ替え確定、1要素放出を確定snapshot候補とする
- §14：全入力をbuffer → 並べ替え確定 → 1件ずつ放出し、Comparatorキーを表示
- §20：Phase 3の完了条件に`sorted`構造snapshotの正しさを含む
- §21.5 J-2：`sorted`の例外規定をPhase 3着手前に判断

Java 25の公式仕様も確認してください。

- `Stream.sorted()`と`Stream.sorted(Comparator)`はstateful intermediate operationである。
- ソートは全入力を確認するまで結果を生成できない。
- ordered Streamではsortはstableである。
- unordered Streamではstability guaranteeはない。

参照先：

- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html
- https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/package-summary.html

一般論や現在の実装都合でDraft v0.8を上書きしないでください。Draft v0.8本体も編集しないでください。

## 4. J-2で確定する結論

### 4.1 結論

`sorted`について、複数要素を同時に「処理中」とする例外は設けません。

並べ替え確定は要素1件の処理ではなく、`sorted`ノードがbuffer全体の順序を確定した操作固有状態として表現します。
そのため、並べ替え確定snapshotでは処理中要素を0件とし、既存の「原則1件」を維持します。

全snapshotにおいて、`elementLatestStates`が`PROCESSING`である要素は最大1件とします。

### 4.2 将来のPhase 3実装で守るsnapshot契約

今回コードへ実装はしませんが、Phase 3実装時の契約として次を確定してください。

#### A. buffer蓄積

- upstreamから`sorted`へ到着した現在要素だけを処理中にする。
- 要素をbufferへ追加した確定時点では、その要素を`BUFFERED`として保持する。
- すでにbuffer済みの別要素を同時に`PROCESSING`へ戻さない。
- bufferは元のencounter orderと安定した要素IDを保持する。
- `sorted`から後段への出力は、全入力の蓄積が完了するまで0件とする。

#### B. 並べ替え確定

- upstream完了後に、buffer全体の並べ替え確定を1つの確定snapshotとして記録する。
- このsnapshotでは`currentElementId`を`null`とする。
- `elementLatestStates`に`PROCESSING`を残さない。buffer内要素は`BUFFERED`のままとする。
- 処理中パネルは個別要素ではなく、`sorted`ノードの一括処理であることを示す。
- 操作固有状態には少なくとも次を保持する方針を明記する。
  - 元のbuffer順序（要素IDと表示値）
  - natural orderまたはComparatorの識別可能な定義
  - Comparatorキーまたは比較対象
  - 並べ替え確定後の順序（要素IDと表示値）
  - 放出済み件数または次の放出位置
  - `BUFFERING`、`ORDER_CONFIRMED`、`EMITTING`を区別できるphase
- 同値キーの要素は、ordered Streamでは元のencounter orderを維持する。
- unordered Streamではstableであると表示・保証しない。

#### C. 1要素ずつ放出

- 並べ替え確定後、確定済み順序から1要素ずつ後段へ放出する。
- 放出対象の1要素だけを現在の処理対象とする。
- 放出位置を操作固有状態で更新し、未放出要素と放出済み要素を区別する。
- 1要素は後段を流れ切ってから、次の要素を放出する。
- 「戻る → 進む」でbuffer、確定順序、放出位置、要素状態が完全に再現されること。

#### D. 空・1件・同値キー

- 空Streamでも、空bufferの並べ替えが確定したことを示すsnapshotを1件生成する方針とする。
- 1件Streamでも、buffer蓄積 → 順序確定 → 1件放出の構造を維持する。
- 標準教材データには未整列入力を使う。
- ordered Streamの安定性を検証できるよう、同じsortキーを持つ別要素を含むケースをPhase 3テスト計画へ入れる。

### 4.3 将来のsnapshot名

Phase 3実装時に命名が揺れないよう、判断記録では次を推奨名として確定してください。

- `SORT_BUFFERED`：現在要素のbuffer追加が確定
- `SORT_ORDER_CONFIRMED`：全bufferの並べ替え順序が確定
- `SORT_EMITTED`：確定順序から1要素を後段へ放出

既存の`NODE_ARRIVAL`は、要素が`sorted`ノードへ到着して`PROCESSING`になる時点として継続利用する前提です。
既存命名規約と両立しない事実が見つかった場合は、勝手に別名へ変更せず、差異と代案を報告して停止してください。

## 5. 作成・更新する成果物

### 5.1 新規作成

`docs/phase-3-decisions.md`を新規作成し、少なくとも次を記録してください。

1. 文書タイトル「Phase 3 判断記録」
2. 判断日
3. 基準仕様と参照節
4. J-2の判断対象
5. 「複数要素を同時に処理中とする例外は設けない」という結論
6. buffer蓄積、並べ替え確定、1件放出のsnapshot契約
7. `currentElementId`、`elementLatestStates`、将来追加する操作固有状態の関係
8. 空・1件・同値キー・ordered/unorderedの扱い
9. Java 25公式仕様の根拠URL
10. Phase 3実装時の受入条件・テスト観点
11. teeing左右2系統のJ-2は未決定のまま、Phase 5着手前に判断すること
12. 今回はPhase 3の実装を開始していないこと

判断記録には会話履歴へ依存する曖昧な表現を残さず、その文書だけでPhase 3実装者が同じsnapshot列を設計できる粒度で記載してください。

### 5.2 README更新

READMEのドキュメント一覧へ`docs/phase-3-decisions.md`を追加してください。

実装状況は引き続き「Phase 2完了」のままとし、「Phase 3完了」「Phase 3実装中」へ変更しないでください。
必要であれば「Phase 3着手前判断としてJ-2 `sorted`を確定済み」とだけ追記してください。

### 5.3 変更しないもの

次を変更しないでください。

- `docs/Java_Stream_API_Visualization_Spec_Draft_v0.8.docx`
- `docs/phase-1-decisions.md`
- `docs/phase-1-completion-report.md`
- `docs/phase-2-decisions.md`
- `docs/phase-2-completion-report.md`
- `src/**`
- `tests/**`
- `e2e/**`
- `oracle/**`
- `artifacts/**`
- `package.json`、`package-lock.json`

本指示文自体をリポジトリ内へ複製しないでください。

## 6. Phase 3実装時の受入条件として残す内容

`docs/phase-3-decisions.md`には、将来のPhase 3実装で少なくとも次を機械検証するよう記載してください。

1. 全snapshotで`PROCESSING`要素数が0または1であり、2以上にならない。
2. 最初の`SORT_EMITTED`より前に、全入力要素がbufferへ蓄積済みである。
3. `SORT_ORDER_CONFIRMED`は1シナリオにつき1件である。
4. `SORT_ORDER_CONFIRMED`では`currentElementId === null`である。
5. `SORT_ORDER_CONFIRMED`では`PROCESSING`要素が0件である。
6. 並べ替え確定前の後段出力は0件である。
7. 放出順序がnatural orderまたは許可済みComparatorと一致する。
8. ordered Streamで同値キーのencounter orderが維持される。
9. 1回の`SORT_EMITTED`で放出位置が1だけ進む。
10. 戻る→進む、同一revision再実行で同一snapshot列を再現する。
11. 空Stream、1件、未整列、同値キー、Comparator指定を検証する。
12. 全教材templateが500 snapshot以内である。

テストIDそのものはPhase 3実装指示で確定するため、今回新しいVitestやPlaywrightテストは作成しないでください。

## 7. 回帰確認

今回は文書のみの変更ですが、Phase 3分岐元が正常であることを確認するため、次を実行してください。

```bash
npm ci
npm run lint
npm run typecheck
npm run test:unit
npm run build
git diff --check
git diff --stat
git status --short
```

`npm run test:e2e`と`npm run test:oracle`は、今回コード・テスト・基準画像・Oracle fixtureを変更しないため必須としません。
実行した場合は実結果を記録してください。未実行を成功扱いしないでください。

視覚回帰画像、Oracle結果、snapshot予算を再生成しないでください。

## 8. 完了条件

次をすべて満たした場合だけ「J-2 `sorted`仕様確定完了」と報告してください。

- 最新`main`から作成した`phase-3`で作業している。
- `docs/phase-3-decisions.md`が作成されている。
- 「sortedに複数処理中要素の例外を設けない」と明記されている。
- buffer蓄積 → 並べ替え確定 → 1件ずつ放出の契約が具体化されている。
- Java 25のstateful性、全入力buffer、ordered Streamのstable性が反映されている。
- Phase 3実装時の機械検証項目が記録されている。
- teeingのJ-2がPhase 5着手前の持越しとして残っている。
- Draft v0.8、過去Phase文書、ソース、テスト、artifactを変更していない。
- lint、型検査、既存unit、buildが成功している。
- Phase 3の実装を開始していない。
- commit、push、PR、mergeを行っていない。

1項目でも満たせない場合は完了扱いにせず、未達事項と理由を報告してください。

## 9. 完了報告の必須項目

完了報告には次を含めてください。

1. 完了／未完了の判定
2. 基準`main`コミットと作業ブランチ
3. J-2 `sorted`の確定結論
4. 確定したsnapshot契約の要約
5. 作成・更新したファイル
6. 変更していないことを確認した領域
7. 参照したDraft v0.8の節とJava 25公式URL
8. 実行したコマンドと各結果
9. unitテストのファイル数・件数・成功・失敗・skip
10. `git diff --check`、`git diff --stat`、`git status --short`の結果
11. Phase 3実装を開始していないこと
12. commit、push、PR、mergeを行っていないこと
13. teeing J-2の残期限

## 10. 停止条件

次のいずれかに該当した場合は変更を続けず、状況を報告して停止してください。

- `main`にPhase 2統合コミット`0185e64f0e673546c2a3bcacb4472c4bc1fc492b`が含まれない。
- worktreeに未確認のユーザー変更がある。
- 既存`phase-3`が最新`main`を基点としていない、または由来を安全に確認できない。
- Draft v0.8と本指示の結論が両立しない具体的な記述を見つけた。
- J-2確定のためにソースやテストの変更が必要だと判断した。
- 既存回帰テストが変更前から失敗する。
- 仕様根拠を確認できず、推測で判断記録を書く必要が生じた。

未確認の変更をstash、削除、checkout、resetで退避・破棄しないでください。

## 11. 最終禁止事項

- Phase 3のコード実装を開始しない。
- `phase-2`や`main`へ直接変更しない。
- Draft v0.8や過去Phaseの判断記録・完了報告を書き換えない。
- 既存テストを削除、skip、緩和しない。
- 基準画像・Oracle結果・snapshot予算を再生成しない。
- ユーザーの既存変更を破棄しない。
- commit、push、PR作成、mergeを行わない。

