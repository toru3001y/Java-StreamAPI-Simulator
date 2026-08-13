# Java Stream API 可視化シミュレーター 仕様書 v0.13（数値加算merge差分版）

## 1. 版管理（Draft v0.8 §1.2の変更管理に基づく）

- 版番号: **v0.13**（第9版ドラフト）
- 本書の構成: **v0.13 = v0.12（Draft v0.8 + v0.9差分 + v0.10差分 + v0.11差分 + v0.12差分、いずれも無編集のまま保持）+ 本差分文書**。全文転記は行わない。
- 変更理由: v0.11 §2.2で将来拡張とされた数値加算merge（`Long::sum`等）を追加する。同節は「Javaのオーバーフロー・safe integer範囲・doubleの丸めを整理したうえで、型付きの数値mergeファミリーとして設計する（場当たり追加はしない）」ことを追加の条件としており、本書の§3がその整理、§2がファミリー設計である。Phase 8完了報告§17の持越し事項4番の解消。
- 作成日: 2026-08-13

### 1.1 優先順位

**本書の明示的な数値加算merge固有規定だけがv0.8〜v0.12に優先する。**本書が明示的に変更していない一般原則・不変条件・検証順序・UI原則はすべて先行版を適用する。既存mergeFunction 3種（first / last / concat）の意味論・snapshot列・表示は変更しない。

### 1.2 影響するPhase

- **Phase 10（新設）のみ。**Phase 1〜9の意味論・受入条件・完了報告は変更しない（Phase 8完了報告§17の持越し事項の解消記録を追記する）。
- 既存templateのsnapshot列・視覚回帰基準画像への影響はない（新規template 3件の追加のみ。新template titleは既存最長〔toMap identity template〕以下に抑え、教材Pipeline selectの内在幅を変えない。v0.12 §5と同じ制約）。

## 2. mergeFunctionファミリーの追加（v0.11 §8.4への追加）

### 2.1 IDホワイトリスト（`ToMapMergeId`への追加3種）

| ID | Java表示 | 意味（UI併記） | 型制約 |
|---|---|---|---|
| `sumInt` | `Integer::sum` | 既存値と新しい値を加算 | **U=Integerのみ**。違反は`TYPE_MISMATCH`で実行前拒否 |
| `sumLong` | `Long::sum` | 既存値と新しい値を加算 | **U=Longのみ**。同上 |
| `sumDouble` | `Double::sum` | 既存値と新しい値を加算 | **U=Doubleのみ**。同上 |

- 引数順は既存どおり（Map内の既存値, 新しい値）。根拠はv0.11 §3.2（`Map.merge`契約）。加算は可換だが、契約・表示・snapshot列の表現は変えない。
- Java表示は既存3種のlambda表記と異なり**メソッド参照**とする。表記は3引数`reduce`のcombiner表示（`Integer::sum` / `Long::sum` / `Double::sum`。Phase 4実装済み）と同一へ揃える。
- 3種ともnullを返さないため、`Map.merge`のnull削除意味論は引き続き対象外（v0.11 §2.2）。
- snapshot列は既存の重複キー解決列（`DUPLICATE_KEY_DETECTED` → `MERGE_FUNCTION_APPLIED` → Map更新）を**そのまま**使う。新しいSnapshotKindは追加しない。teeing branch配置時の更新kind排他はv0.12 §6の既定に従う。

### 2.2 型制約の一般化（`requiresString`の置換）

- `TO_MAP_MERGE_META`の型制約フィールド`requiresString: boolean`を**`requiredValueWrapper: 'String' | 'Integer' | 'Long' | 'Double' | null`**へ置換する（null = 任意の同一型U）。first / last = `null`、concat = `'String'`、sum系 = 各wrapper名。
- 既存concatの受理・拒否結果は不変（`'String'`指定は`requiresString: true`と同値）。
- 値型Uの導出は既存`resolveToMapValueType`を変更なしで流用する（fieldAccess `age`→`Integer` / `salary`→`Long` / `evaluation`→`Double`のboxing済みwrapper。`identity`のU=Employeeはsum系3種すべて`TYPE_MISMATCH`）。
- 型不一致は従来どおり`TYPE_MISMATCH`（path = `collector.mergeFunctionId`）。

## 3. 数値意味論の整理（v0.11 §2.2の条件への回答）

### 3.1 Java SE 25仕様（一次情報。2026-08-13取得）

- **`Integer.sum(int, int)`**: "Adds two integers together as per the + operator."
- **`Long.sum(long, long)`**: "Adds two `long` values together as per the + operator."
- **`Double.sum(double, double)`**: "Adds two `double` values together as per the + operator." API Note: "This method corresponds to the addition operation defined in IEEE 754."
- **整数加算のオーバーフロー**（JLS 15.18.2）: 整数加算はオーバーフロー時に例外を送出せず、十分大きな2の補数形式で表した数学的な和の下位ビットが結果となる（ラップ）。
- **浮動小数点加算**（JLS 15.4）: "The result of a floating-point operator of the Java programming language must match the result of the corresponding IEEE 754 operation on the same operands."

### 3.2 int（`Integer::sum`）

- Javaのint加算はオーバーフロー時にラップするが、JavaScript number（IEEE 754 binary64）はラップせず精度内で計算が続く。この差があるため、**本教材の実行値域はラップが発生しない範囲に限定する**。防衛線は既存と同一の2段: (1) DSL定数の既存int32範囲検証、(2) 固定fixtureの値設計（ageの合計は最大でも2桁×件数）。
- ラップ意味論そのもの（`Integer.MAX_VALUE + 1`が`Integer.MIN_VALUE`になる）は実行対象にせず、**補助説明（jdkNote）で明示**する。オーバーフローを主題とする教材はv0.8 §3.2の対象外宣言（「null、NaN、Infinity、overflow、例外を主題とする教材」）を維持する。
- Oracle照合には桁あふれしない組合せのみを用いる（`docs/phase-6-decisions.md` §7.3の既存判断の踏襲）。

### 3.3 long（`Long::sum`）

- 扱う値・合計はJavaScriptのsafe integer範囲（±2^53−1）に限定する。防衛線は既存と同一: DSL定数の`Number.isSafeInteger`検証、Import Contractのlong値域規定、固定fixtureの値設計（salary合計は最大15,700,000）。
- `Long.MAX_VALUE` / `MIN_VALUE`境界値は本機能では扱わない（P4-O01の10進文字列境界検証の対象へ追加しない）。
- Javaのlong加算のラップはintと同様に補助説明でのみ扱う。

### 3.4 double（`Double::sum`）

- `Double.sum`は§3.1のとおり**+演算子による素朴な加算（IEEE 754の加算そのもの）であり、補償付き加算ではない**。Simulation Coreの加算（JavaScript numberのIEEE 754 binary64加算）と演算が一致し、mergeの適用順もencounter orderで両側一致するため、**Oracle照合の対象とする**。
- これは`Collectors.summingDouble`系とは**逆の結論**である。DoubleStreamのsum / averageを照合対象外にした判断（`docs/phase-6-decisions.md` §7.2）の根拠は「JDKのCollectors側が補償付き加算`sumWithCompensation`を使い、Coreの素朴加算との差がノイズになる」ことだった。toMapのmergeFunctionはJDK側も素朴加算であるため、この非対称は照合可能側に倒れる。
- 10進小数（4.1等）の2進表現誤差により、合計の表示は`12.399999999999999`のような値になり得る。両側で同一に発生するため照合可能であり、**丸め誤差の顕在化は教材上の見どころとして補助説明で明示**する。表記は既存の`formatDoubleLiteral`（Core）/ `coreDouble`（Oracle）の整合機構を流用する。

### 3.5 実行時range checkを追加しない判断

数値mergeの実行時に合計の値域チェックは追加しない。toMapを含むtemplateは手動連携の取込対象外（v0.11 §10-6）であり外部入力経路が存在しないため、値域保証は固定fixture契約（§3.2〜§3.4）で完結する。取込を将来開放する場合は、Import Contractの値域規定へ「合計の値域」を追加してから開放する。

## 4. template / fixture / oracle（v0.11 §8.6・v0.11 §8.2への追加）

- 新template 3件（standardのみ、employeesMergeDemo 5件、keyMapper = `Employee::region`。既存merge template群・groupingBy比較templateと同一fixture・同一keyMapper）:

| templateId | valueMapper | mergeFunction | 期待結果 |
|---|---|---|---|
| `tmpl-collect-tomap-merge-sumint` | `Employee::age` | `Integer::sum` | `{関東=95, 関西=33, 中部=30}` |
| `tmpl-collect-tomap-merge-sumlong` | `Employee::salary` | `Long::sum` | `{関東=15_700_000L, 関西=5_200_000L, 中部=4_900_000L}` |
| `tmpl-collect-tomap-merge-sumdouble` | `Employee::evaluation` | `Double::sum` | 関東=`4.1 + 4.4 + 3.9`のIEEE 754逐次加算（期待ラベルはCore実測で確定し、JDK 25実測で照合する） |

- 関東は3件衝突のため、mergeの順次適用（「現在Mapにある値」への繰り返し適用。v0.11 §4の4）が1実行で2回観測できる。
- template説明では、既存first / last / concat template（同一データで「選ぶ・つなぐ」）とgroupingBy比較templateへの相互参照導線を設ける（「groupingByは同じキーの値をListへ蓄積する / toMap+数値mergeは1つの合計値へ畳み込む」）。
- 数値merge 3 templateのjdkNotesへ§3.2〜§3.4の意味論注記（intラップ・safe integer限定・doubleの丸め）を付す。既存の全toMap template共通の「数値加算mergeは対象外」注記（`TO_MAP_OUT_OF_SCOPE_NOTES`）は削除する。他の対象外注記（toConcurrentMap / toUnmodifiableMap / key側identity）は不変。
- oracle照合キー（`expected-p8-from-core.json` / `OracleP8.java`への追加）: `toMapSumIntByRegion` / `toMapSumLongByRegion` / `toMapSumDoubleByRegion`。JDK 25実測とJSON厳密照合する（表記は既存整合規約: longは3桁区切り+L表記、doubleは`coreDouble` / `formatDoubleLiteral`の両側整合）。
- 手動連携（LLM取込）: toMap slotを持つtemplateの取込対象外規定（v0.11 §10-6）により自動で取込対象外（importable: false）。開放判断は変更しない。

## 5. 完了条件

- 新merge 3種のDSL検証（ID受理・型制約`TYPE_MISMATCH`・closed schema不変）・実行（順次適用のsnapshot列）・表示（メソッド参照表記・意味併記）・説明文のテストが成功すること。
- 新template 3件が決定的に実行され、snapshot予算内であること。
- oracle照合（P8-O01への3キー追加）がJDK 25実測と完全一致すること。
- 既存P1〜P9テストの削除・緩和・skipなし（template総数・mode組合せ等の意図的なassert更新、および「数値加算mergeは対象外」文言の削除に伴うP8-R04の書換えを除く）。
- 視覚回帰基準画像の更新ゼロ。
- 統合docx（第30章）のビルド・verify合格。
