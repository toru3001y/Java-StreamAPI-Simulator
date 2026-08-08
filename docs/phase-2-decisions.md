# Phase 2 判断記録

Phase 2実装指示 §14で要求された実装判断の記録。Draft v0.8本体は編集しない。
Phase 1の記録（`docs/phase-1-decisions.md`）は保持し、書き換えない。

## 1. generate / 2引数iterate のPhase境界（指示 §6.1）

**判断日**: 2026-08-08

### 実装済みの範囲

- OperationCatalog: `source.generate`（unordered / infinite）、`source.iterate2`（ordered / infinite）を
  sourceMeta付きで登録（`src/domain/catalog/operations.ts`）。
- Source DSL: `{ kind: 'generate', ruleId }`（許可rule: `supplier-counter`）、
  `{ kind: 'iterate2', seed, operator }`（許可operator rule: `increment`）を構造・型検証付きで表現
  （`src/domain/dsl/sourceAst.ts`、`validateSource.ts`）。未知rule IDは拒否する。
- Javaコード生成: `Stream.generate(counter::incrementAndGet)`（`AtomicInteger counter`宣言付き）、
  `Stream.iterate(1, n -> n + 1)` を正当なJava 25構文で生成（`javaCode.ts`）。
- 説明生成: 無限・unordered等の性質を含む自然文（`explanation.ts`）。
- template: `tmpl-src-generate` / `tmpl-src-iterate2` を `executable: false` +
  disabledReason付きで登録（`templates.ts`）。

### 実行不能の境界

- `instantiateTemplate` は §9.3手順6の有限性検証で、source kindが `generate` / `iterate2` の候補を
  **PipelineDefinition生成前に** `UNBOUNDED_SOURCE` の構造化エラーとして拒否する（`instantiate.ts`）。
- fixture要素数・500 snapshot上限による暗黙の打ち切りは行わない（具現化自体を実行しない）。
- 表示JavaコードへASTに存在しない `.limit(...)` を追加しない。
- `limit()` のtraits / handler / snapshot / 通過件数表示は一切実装していない。
- UI: 対象操作セレクトでdisabled表示とし、「無限Streamのため実行できません。Phase 3の
  有限化操作（limit()）の実装後に実行可能になります。」を選択肢のtitleと注記リストに表示する
  （`ScenarioControls.tsx`、P2-R01で検証）。

### Phase 3での昇格手順

`limit()` 実装後、(1) templateへlimitノードを追加、(2) `UNBOUNDED_SOURCE` 判定を
「有限化操作が後段に存在しない場合のみ拒否」へ拡張、(3) `executable: false` を解除する。
エンジン・DSL・コード生成は変更不要な構造にしてある。

## 2. flatMap親子snapshotとJ-2（指示 §6.2）

**判断日**: 2026-08-08

### 採用した解釈（§12.6「処理中は原則1件」の維持）

- mapped Stream生成snapshot（`MAPPED_STREAM_CREATED`）では**親要素だけ**が現在の処理対象。
- 親のflatMap評価は mapped Stream生成の時点で確定とみなし、親の状態は生成snapshotで
  `PASSED` へ遷移する。以降の子要素処理中、親は `parentElementId` と `flatMapContext`
  （親ラベル・子一覧・送出数・close状態）の**文脈情報としてのみ**保持する。
- 子要素送出snapshot（`CHILD_EMITTED`）以降は**子要素だけ**が処理中となる。
  親と子を同時に2件の「処理中」として表示しない（P2-D17で機械検証）。
- 子はencounter orderどおり1件ずつ送出され、各子は次の子の前に後段（boxed / toList）を流れ切る。
- mapped Streamのcloseは独立snapshotにせず、
  - 子0件: `MAPPED_STREAM_CREATED` snapshot自体の詳細で `closed: true`
  - 子1件以上: **最後の子の処理完了snapshot**の詳細で `closed: true`
  として反映する（P2-D19で検証）。
- 親0件（空ソース）ではmapped Streamは一度も生成されない。

この解釈で「親と子を同時に処理中にしないと成立しないケース」は発生しなかったため、
J-2の例外は不要であり、停止条件（指示§17）には該当しない。

### J-2の期限（変更なし）

- sortedの一括並べ替え確定: **Phase 3着手前**
- teeing左右2系統: **Phase 5着手前**

## 3. その他の実装判断（仕様本文を変更しない範囲）

### 3.1 map系snapshotの粒度

§9.2の「要素到着 / mapper適用確定 / 変換後要素の後段送出」を、
`NODE_ARRIVAL` → `MAPPING_APPLIED` → `MAPPED_EMITTED` の3確定snapshotとして表現した。
型区間の変化は `MAPPING_APPLIED` / `MAPPED_EMITTED` の `typeTransition` に保持する。

### 3.2 iterate 3引数のsource snapshot

§9.1の「source候補/要素の生成または取得」を `SOURCE_CANDIDATE`（seed / operatorによる候補生成）と
`SOURCE_PREDICATE_EVALUATED`（判定確定）の独立snapshotとして表現した。
falseとなった最終候補も判定snapshotとして表示し、生成終了を説明する。

### 3.3 シナリオモードの提供範囲（指示 §8.1）

- source系template・map系template: 標準 + 空ソース。途中0件は「対象操作の直前に検証済みfilterが
  必要」なため、基準Pipeline（仕様§8の例）の形を変えずには成立しない。機械的な偽装をせず
  `supportedModes` から除外し、UIで選択不能（理由付き）とした。
- mapの途中0件は、filterを含む別template `tmpl-map-midempty`（`filter(age >= 100)` 併用）として提供。
  これにより同一target operationへの複数template登録（P2-D20）も実地で使用している。
- flatMapの途中0件は「全親が空List（子0件）」として自然に成立するため提供する。
- empty系templateは空ソースモードのみ（それが教材の主題のため）。

### 3.4 教材制約の解釈（指示 §8.1）

- map系「変換前後が視覚的に異なる」: 対象mapper適用後の表示ラベルが入力と異なることを検証する。
  `boxed` はmapperを持たないため対象外とし、型の変化（IntStream → Stream<Integer>）を
  `typeTransition` で強調する。
- 途中0件の「結果0件」検証は事前実行（timeline）の結果を要するため、
  §9.3手順6（予算検証）の後に実施している。手順5の教材制約（データ有無・true/false双方・
  複数子・視覚変化）は手順どおり手順5で検証する。

### 3.5 Step Engineの内部方式

`next(currentSnapshot, def)` の外部契約は維持したまま、内部はPipelineDefinitionから
決定的timeline（全snapshot列）を純粋に導出しWeakMapでキャッシュする方式へ変更した。
同一revisionから常に同一のsnapshot列が得られ（P2-D25）、Phase 1のfilter snapshot列は
種別・順序・件数とも完全に維持されている（P2-D26）。

### 3.6 P1視覚回帰基準画像の更新

操作選択UI（対象操作セレクトの実操作一覧化・非実行操作の理由注記）の追加により、
P1-E11の期待画像4枚を意図的に再生成した。差分はScenarioControls領域のみであることを
実画像で確認済み。Pipeline・入力/処理中/出力・Javaコード・説明・stickyバーの描画は
Phase 1と同一である。

### 3.7 最終レビュー対応（2026-08-08）

- **Mapper全8フィールド**: SimValueへ `localDate`（表示はLocalDate.toStringのISO形式）と
  `department`（表示はJava recordのtoString形式 `Department[name=…, division=…]`）を追加し、
  `fieldAccess` の評価を全8フィールドへ拡張。型解決（`resolveMapperOutputType`）は
  既存のEMPLOYEE_FIELDS由来で全フィールド対応済みだったため、評価器と値モデルのみ拡張した。
- **iterate3の有限性**: 「seedがpredicateを満たす場合はstep >= 1が必要」という終了性ルールを
  §9.3手順6（有限性検証）へ追加し、`UNBOUNDED_SOURCE`で拒否する。従来の10,000件安全上限は
  「正常終了として返す打ち切り」から「到達時に例外を送出する内部不整合ガード」へ変更した
  （有限性検証を通過した候補は原理的に到達しない）。あわせて構造検証にJava int32範囲、
  instantiateに最終候補のoverflowと要素数下限見積りによる事前予算検証を追加した
  （range / rangeClosedにも同じ事前予算検証を適用）。
- **Arrays.stream(long[]/double[])**: `tmpl-src-arrays-long` / `tmpl-src-arrays-double` を追加し、
  同一target operation（source.arraysStream）のtemplateは4件になった。

### 3.8 P1テストの微修正（削除・緩和なし）

- `P1-D02`（Catalog拡張性）: 拡張登録の検証に使う操作IDを `map` から未登録の
  `custom.futureOp` へ変更（Phase 2で `map` が標準登録されたため）。検証内容は不変。
- `P1-R01`: snapshot IDの期待値を、revision発行形式の正規表現へ更新済み（Phase 1レビュー対応時）。
- `tests/domain/oracleSync.test.ts`: dataset要素の値がSimValue化されたためアクセサのみ更新。
