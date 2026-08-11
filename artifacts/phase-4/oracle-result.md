# P4-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-08T14:02:14.363Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP4.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"reduceConcat":"JavaSQLGit","reduceConcatEmptyPresent":false,"reduceIntNoIdentity":8,"reduceIntEmptyPresent":false,"reduceIntIdentity":108,"reduceIntIdentityEmpty":100,"reduceSalary":21700000,"reduceCombinerCalls":0,"count":4,"countEmpty":0,"peekCountResult":2,"minAge":"鈴木","maxAge":"高橋","minAgeEmptyPresent":false,"minInt":1,"maxLong":30,"minDouble":1.5,"minIntEmptyPresent":false,"findFirst":"佐藤","findFirstEmptyPresent":false,"findAnyPresent":true,"anyMatch":true,"anyMatchCalls":3,"allMatch":false,"allMatchCalls":2,"noneMatch":false,"noneMatchCalls":3,"anyMatchEmpty":false,"allMatchEmpty":true,"noneMatchEmpty":true,"emptyMatchPredicateCalls":0,"sumInt":8,"sumLong":60,"sumDouble":4,"sumIntEmpty":0,"sumLongEmpty":0,"sumDoubleEmpty":0,"avgInt":2.5,"avgLong":20,"avgDouble":2.5,"avgEmptyPresent":false,"statsInt":[4,10,1,4,2.5],"statsLong":[3,60,10,30,20],"statsDouble":[3,7.5,1.5,3.5,2.5],"statsIntEmpty":[0,0,2147483647,-2147483648,0],"statsLongEmpty":[0,0,"9223372036854775807","-9223372036854775808",0],"statsDoubleEmptyCount":0,"statsDoubleEmptyMinIsPositiveInfinity":true,"statsDoubleEmptyMaxIsNegativeInfinity":true,"objectArrayLength":4,"objectArrayComponent":"Object","stringArray":["Java","SQL"],"stringArrayComponent":"String","intArray":[3,1,4],"emptyStringArrayLength":0,"emptyStringArrayComponent":"String","forEachActions":["佐藤","鈴木","高橋","田中"],"forEachOrderedActions":[3,1,4],"forEachEmptyCalls":0,"toListUnmodifiable":true}
- 実測値（JDK 25実行結果）    : {"reduceConcat":"JavaSQLGit","reduceConcatEmptyPresent":false,"reduceIntNoIdentity":8,"reduceIntEmptyPresent":false,"reduceIntIdentity":108,"reduceIntIdentityEmpty":100,"reduceSalary":21700000,"reduceCombinerCalls":0,"count":4,"countEmpty":0,"peekCountResult":2,"minAge":"鈴木","maxAge":"高橋","minAgeEmptyPresent":false,"minInt":1,"maxLong":30,"minDouble":1.5,"minIntEmptyPresent":false,"findFirst":"佐藤","findFirstEmptyPresent":false,"findAnyPresent":true,"anyMatch":true,"anyMatchCalls":3,"allMatch":false,"allMatchCalls":2,"noneMatch":false,"noneMatchCalls":3,"anyMatchEmpty":false,"allMatchEmpty":true,"noneMatchEmpty":true,"emptyMatchPredicateCalls":0,"sumInt":8,"sumLong":60,"sumDouble":4,"sumIntEmpty":0,"sumLongEmpty":0,"sumDoubleEmpty":0,"avgInt":2.5,"avgLong":20,"avgDouble":2.5,"avgEmptyPresent":false,"statsInt":[4,10,1,4,2.5],"statsLong":[3,60,10,30,20],"statsDouble":[3,7.5,1.5,3.5,2.5],"statsIntEmpty":[0,0,2147483647,-2147483648,0],"statsLongEmpty":[0,0,"9223372036854775807","-9223372036854775808",0],"statsDoubleEmptyCount":0,"statsDoubleEmptyMinIsPositiveInfinity":true,"statsDoubleEmptyMaxIsNegativeInfinity":true,"objectArrayLength":4,"objectArrayComponent":"Object","stringArray":["Java","SQL"],"stringArrayComponent":"String","intArray":[3,1,4],"emptyStringArrayLength":0,"emptyStringArrayComponent":"String","forEachActions":["佐藤","鈴木","高橋","田中"],"forEachOrderedActions":[3,1,4],"forEachEmptyCalls":0,"toListUnmodifiable":true}
- 比較方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定（64bit境界値は10進文字列のまま比較し、numberへ変換しない）
- 判定: PASS（完全一致）

## 観測記録（厳密比較の対象外。JDKの保証として扱わない）
- findAnyObservedElement=佐藤（JDKは特定要素を保証しない。教材fixtureの選択は移植可能な保証ではない）
- peekCallsDuringCount=0（count結果=2。評価省略は仕様上可能だが必須の動作ではなく、今回のJDKでの観測結果である）

## P4必須Oracle IDの結果（P4-O01〜O03）
- P4-O01: PASS（JDK 25実測値とSimulation Core期待値のJSON完全一致）
- P4-O02: PASS（Long境界値の損失なし照合）
  - Long.MAX_VALUE（空LongSummaryStatisticsのmin）: `9223372036854775807`
  - Long.MIN_VALUE（空LongSummaryStatisticsのmax）: `-9223372036854775808`
  - 比較方式: 10進文字列のまま完全一致比較（JavaScript numberへ変換せず、1桁も損失しない）
  - string型・正確値の検証（期待値 / 実測値）: PASS / PASS
- P4-O03: PASS（Oracle証跡書込みのP4限定）
  - 必須4 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01）が各1件存在（欠落・重複なし）: PASS
  - 書込みはP4のみ（P1〜P3はwriteReportPath: nullの照合のみ。書込み先はartifacts/phase-4/oracle-result.mdだけ）: PASS
  - 実行前後でartifacts/phase-1〜3のSHA-256が不変: PASS
- 総合判定: PASS（P4-O01〜O03のいずれかがFAILなら総合もFAIL）

## 関連する機械検証
- P4-O02（Long境界値の損失なし照合・近接誤値の不一致判定・結果欄の生成検証）: `tests/domain/p4-review.test.ts`
- P4-O03（P1〜P3は照合のみ・P4だけ証跡書込み・結果欄の生成検証）: `tests/domain/p4-review.test.ts`
- 期待値とSimulation Coreの一致: `tests/domain/p4-oracleSync.test.ts`
