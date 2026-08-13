# Java Stream API 可視化シミュレーター 仕様書 v0.12（teeing × toMap差分版）

## 1. 版管理（Draft v0.8 §1.2の変更管理に基づく）

- 版番号: **v0.12**（第8版ドラフト）
- 本書の構成: **v0.12 = v0.11（Draft v0.8 + v0.9差分 + v0.10差分 + v0.11差分、いずれも無編集のまま保持）+ 本差分文書**。全文転記は行わない。
- 変更理由: Phase 8で「未完了」のまま持ち越されたteeing branchへのtoMap配置（v0.11 §6.3 / v0.11 §6.2の9。P8-D18=未実装・P8-D15=部分実装〔6配置中5配置〕）を解消するため。構築不能の原因は、teeing merger recordが`SalarySummary(long, double)`の1件のみでMap結果のbranchを受けられないという**ツール側の自主制約**であり（Javaのteeingはmergerの引数型がbranch結果型と一致する限り任意のBiFunctionを許す）、`Map<String, String>`を受けるmerger record 1件を追加して解消する（`docs/phase-8-decisions.md` §9.1のA案の実施）。
- 作成日: 2026-08-13

### 1.1 優先順位

**本書の明示的なteeing × toMap固有規定だけがv0.8〜v0.11に優先する。**本書が明示的に変更していない一般原則・不変条件・検証順序・UI原則はすべて先行版を適用する。

### 1.2 影響するPhase

- **Phase 9（新設）のみ。**Phase 1〜8の意味論・受入条件・完了報告は変更しない（Phase 8完了報告§17の持越し残作業の解消記録を追記する）。
- 例外として、teeing走査の経路復元（§4）は既存Phase 5 teeing templateのsnapshot中`currentPath`（右branch処理時）を変更する。これはv0.11 §6.2の9が期待する値への修正であり、Phase 5の既存テストは右branch経路を検証していないため回帰影響はない（視覚回帰基準画像もmerger適用時点〔`currentPath = []`〕のみで画素不変。実測で確認済み）。

## 2. teeing merger recordの追加（v0.8 §9.1 / v0.11 §8.6への追加）

### 2.1 RegionIndex::new

`TEEING_MERGER_IDS`へ次の1件を追加する（既存`SalarySummary::new`は不変）。

```java
record RegionIndex(Map<String, String> byRegion, long count) {}
```

- 左branch（fields[0]）= `Map<String, String>`結果のCollector、右branch（fields[1]）= `Long`結果のCollectorを受ける。
- merger recordは**2フィールド固定・左=fields[0] / 右=fields[1]の位置対応**という既存規約を維持する。

### 2.2 型検証のTypeRef化

- merger recordのフィールド定義は、record宣言行へそのまま出す表示用Java表記（`javaType: string`）と、検証用の`expected: TypeRef`を持つ。branch結果型の照合は`typeRefEquals`による**TypeRef構造比較**へ一般化する（v0.11までの`Long` / `Double`名前決め打ち比較を置換。既存SalarySummaryの受理・拒否結果は不変）。
- 型不一致は従来どおり`TYPE_MISMATCH`（path = `collector.left` / `collector.right`）。`SalarySummary::new`へのtoMap配置は引き続き拒否される。

## 3. teeing branchのMap生成表示（v0.11 §6.3親種別表teeing行の実装確定）

実効コンテナ（adapter系を辿った先）がtoMapのbranchについて、Map生成の表示は次のcontext（jdkNote）で表す。独立の`CONTAINER_CREATED`は発行しない（v0.11 §6.3どおり）。

- `TEE_BRANCH_ACCUMULATED`を発行するbranch: 当該branchの**初回`TEE_BRANCH_ACCUMULATED`**のjdkNote（2件目以降には付けない）。「初回」は当該branchで最初に発行された`TEE_BRANCH_ACCUMULATED`を指し、**要素がMapへ到達したかは問わない**（adapter経由でfilter除外された要素のbranch確定も含む）。
- `TEE_BRANCH_ACCUMULATED`を1件も発行しないbranch（0件branch）: **`TEE_BRANCH_FINISHED`**のjdkNote。
- 発行済みかどうかは**Mapのentry有無から導出せず、branchごとの独立状態（発行済みフラグ）で管理**し、全snapshot列で正確に1回とする（entry有無からの導出では、adapter経由でfilter除外が続きMapが空のまま次要素へ進んだとき、注記が重複発行される）。
- 文言: 「このbranchのMap（`<Map | TreeMap>`）はbranch蓄積の開始と同時に用意されます（独立のCONTAINER_CREATEDは発行しません）。」（bucket配置の既存文言に揃える）

## 4. teeing branch経路の復元（v0.11 §6.2の9の実装確定）

teeing走査は左右branch間で経路（`ctx.path`）を復元する。右branch処理時の`currentPath` / 失敗時の`collectorPath`は`['c0', 'c0.right']`となる。従来実装の`['c0', 'c0.left', 'c0.right']`はv0.11 §6.2の9の期待値と不一致だったため修正した（Phase 8完了報告§17の残作業(1)）。

## 5. template / fixture / oracle（v0.11 §8.6・v0.11 §8.2への追加）

- 新template **`tmpl-collect-teeing-tomap`**（standardのみ）: `collect(Collectors.teeing(Collectors.toMap(Employee::region, Employee::name, (a, b) -> a, TreeMap::new), Collectors.counting(), RegionIndex::new))` × employeesMergeDemo 5件。
  - 1回の実行で成功put（emp-101 / 104 / 105）とmerge（emp-102 / 103）の両分岐を通過し、左branchはTreeMapのため結果が決定的（oracle正規化不要）。
  - 期待結果: `RegionIndex[byRegion={中部="小林", 関東="伊藤", 関西="中村"}, count=5]`。snapshot実測40件（予算 limit 500 / estimatedMax 80）。
- oracle照合キー（`expected-p8-from-core.json` / `OracleP8.java`への追加）: `teeingToMapByRegion`（TreeMap実entry順の単一文字列）/ `teeingToMapCount`（`"5"`）。OracleP8.javaへ同形recordを追加しJDK 25実測とJSON厳密照合する。record宣言行を含む画面表示Javaコードと同一形のコードがJDK 25でコンパイル・実行できることが、型検証スキップ案（B案）却下理由の裏取りを兼ねる。
- 手動連携（LLM取込）: toMap slotを持つtemplateを取込対象外とする既存規定（開放可否はv0.11 §10の判断事項であり、Phase 8で対象外と確定）により自動で取込対象外（importable: false）。`mergerId`のenumは`TEEING_MERGER_IDS`から自動追随する。

## 6. 更新kindの排他の実行検証（v0.11 §6.3の実装確定）

v0.11 §6.3の既定を実装・テスト固定した（本書での規定変更はない）:

- branch直下のtoMap: 成功 `TO_MAP_KEY_EVALUATED → TO_MAP_VALUE_EVALUATED → TEE_BRANCH_ACCUMULATED` / merge `… → DUPLICATE_KEY_DETECTED → MERGE_FUNCTION_APPLIED → TEE_BRANCH_ACCUMULATED`。同一更新へ`CONTAINER_UPDATED`を重ねない。
- branch内部（adapter経由。例: `filtering(…, toMap(…))`）: 内部更新は`CONTAINER_UPDATED`どおり発行し、branch確定の`TEE_BRANCH_ACCUMULATED`を**別事象として1件**発行する。内部更新のない要素（filter除外）でもbranch確定は発行する。
- 重複キー失敗要素: `DUPLICATE_KEY_DETECTED → COLLECT_FAILED`終端。当該要素の`TEE_BRANCH_ACCUMULATED`は不発行、残りbranchは未処理。失敗したbranchの状態はACCUMULATEDのまま残さず、蓄積中（ACCUMULATING）へ戻す。
- 表示上の許容: branch直下toMapの中間snapshot（`TO_MAP_KEY_EVALUATED`等）は、branch状態がACCUMULATED表示のまま発行される（従来のcounting等では中間snapshotがなく顕在化しなかった粗。結果・snapshot列の正しさに影響しないため許容し、修正は行わない）。

## 7. 完了条件

- P8-D18のテストが成功すること。検証対象は次のすべて: **branch直下**の成功put / merge / 重複キー失敗、**branch内部（adapter経由）**の内部`CONTAINER_UPDATED` + branch確定`TEE_BRANCH_ACCUMULATED`の別事象発行、**生成注記が全snapshot列で正確に1回**であること（初回要素がfilter除外されるケースと全要素除外ケースを含む）。
- P8-D15第6配置（teeing branch失敗時の`collectorPath` / `bucketPath`配列完全一致）のテストが成功し、Phase 8必須39 IDがすべて完全成功となること。
- 既存P1〜P8テストの削除・緩和・skipなし（Phase 8完了報告§17で「書き換え前提」と明記されていた固定テスト〔`p8-failure.test.ts`のP8-D18記録・P8-D15未実施記録〕の実装版への書き換えを除く）。
- oracle照合（P8-O01へのキー追加）成功。
