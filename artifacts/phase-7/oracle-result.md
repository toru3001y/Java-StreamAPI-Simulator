# P7-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-12T20:10:18.706Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP7.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"windowFixed3":["[佐藤（age=35）, 鈴木（age=27）, 高橋（age=42）]","[田中（age=29）]"],"windowFixed2":["[佐藤（age=35）, 鈴木（age=27）]","[高橋（age=42）, 田中（age=29）]"],"windowFixedEmpty":[],"windowSliding2":["[\"Java\", \"SQL\"]","[\"SQL\", \"Git\"]","[\"Git\", \"AWS\"]"],"windowSlidingShort":["[\"Java\", \"SQL\"]"],"windowSlidingEmpty":[],"scanSum":["3","4","8"],"scanEmpty":[],"scanConcat":["\"Java\"","\"JavaSQL\"","\"JavaSQLGit\""],"foldSalaryPresent":true,"foldSalary":"21_700_000L","foldEmptyPresent":true,"foldEmpty":"0L","scanElementClass":"Integer","foldElementClass":"Long"}
- 実測値（JDK 25実行結果）    : {"windowFixed3":["[佐藤（age=35）, 鈴木（age=27）, 高橋（age=42）]","[田中（age=29）]"],"windowFixed2":["[佐藤（age=35）, 鈴木（age=27）]","[高橋（age=42）, 田中（age=29）]"],"windowFixedEmpty":[],"windowSliding2":["[\"Java\", \"SQL\"]","[\"SQL\", \"Git\"]","[\"Git\", \"AWS\"]"],"windowSlidingShort":["[\"Java\", \"SQL\"]"],"windowSlidingEmpty":[],"scanSum":["3","4","8"],"scanEmpty":[],"scanConcat":["\"Java\"","\"JavaSQL\"","\"JavaSQLGit\""],"foldSalaryPresent":true,"foldSalary":"21_700_000L","foldEmptyPresent":true,"foldEmpty":"0L","scanElementClass":"Integer","foldElementClass":"Long"}
- 比較方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定（64bit境界値は10進文字列のまま比較し、numberへ変換しない）
- 判定: PASS（完全一致）

## 観測記録（厳密比較の対象外。JDKの保証として扱わない）
- windowFixed.integratorIsGreedy=true
- windowFixed.combinerIsDefault=true
- windowFixed.finisherIsDefault=false
- windowSliding.integratorIsGreedy=true
- windowSliding.combinerIsDefault=true
- windowSliding.finisherIsDefault=false
- scan.integratorIsGreedy=true
- scan.combinerIsDefault=true
- scan.finisherIsDefault=true
- fold.integratorIsGreedy=true
- fold.combinerIsDefault=true
- fold.finisherIsDefault=false
- windowFixed.windowIsUnmodifiable=true

## P7必須Oracle IDの結果（P7-O01・P7-O02）
- P7-O01: PASS（JDK 25実測値とSimulation Core期待値のJSON完全一致）
  - 対象は§8.2の11ケース（standard 7 + emptySource 4）の実行結果。v0.9 §7の空入力表4行（windowFixed空 / windowSliding空 / scan空 / fold空）をすべて含む
  - v0.9 §7の「導出」区分2件（scan空・fold空）は、導出と実測が食い違えばこの照合がFAILになる（scan空 → 出力0件、fold空 → Optional[初期値]）
  - 窓・要素のラベルはSimulation Coreのformat（formatSimValue）表記へ両側で揃えて厳密照合（Employee要素は`氏名（age=NN）`、String要素はクォート付き、Listは`[要素1, 要素2]`の再帰整形）
  - longは3桁区切り + L表記（formatLongLiteral）へ両側で揃えて厳密照合し、numberへ変換しない
  - gather出力要素のboxed型名（Integer / Long）はCoreのTypeRefから導出し、Java側は実値のgetClass().getSimpleName()と照合する（v0.9 §8.3の型適合表の裏取り）
  - 組み込み4種の構成要素実装（Greedy / defaultCombiner / defaultFinisher）はOBSERVATION行として厳密比較の対象外に置く（v0.9 §10-3。JDK内部実装を断定せず観測として記録する）
- P7-O02: PASS（Oracle運用検証）
  - 必須7 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01 / P7-O01）が各1件存在（欠落・重複なし）: PASS
  - 証跡書込みは現行Phase（P7）のみ（書込み先はartifacts/phase-7/oracle-result.mdだけ。P1〜P6はwriteReportPath: nullの照合のみ）: PASS
  - 実行前後でartifacts/phase-1〜phase-6のSHA-256が不変: PASS

## 過去Phase suiteの回帰結果（照合のみ・証跡書込みなし）
- P1-O01: PASS（照合のみ・証跡書込みなし）
- P2-O01: PASS（照合のみ・証跡書込みなし）
- P3-O01: PASS（照合のみ・証跡書込みなし）
- P4-O01: PASS（照合のみ・証跡書込みなし）
- P5-O01: PASS（照合のみ・証跡書込みなし）
- P6-O01: PASS（照合のみ・証跡書込みなし）
- P4-O02（Long境界値の損失なし照合をP4 suiteへ適用）: PASS（Long.MAX_VALUE=`9223372036854775807` / Long.MIN_VALUE=`-9223372036854775808`を10進文字列のまま比較）

- 総合判定: PASS（P7-O01・P7-O02のいずれかがFAILなら総合もFAIL）

## 関連する機械検証
- P7-O01（期待値とSimulation Coreの一致）: `tests/domain/p7-oracleSync.test.ts`
- P7-O02（必須7 suite・現行Phase単独書込み・過去artifacts不変の構成検証）: `tests/domain/p7-review.test.ts`
- P6-O02（Phase 6時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p6-review.test.ts`
- P5-O02（Phase 5時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p5-review.test.ts`
- P4-O02 / P4-O03（Phase 4時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p4-review.test.ts`
- 過去Phase期待値とSimulation Coreの一致: `tests/domain/p6-oracleSync.test.ts` 他
