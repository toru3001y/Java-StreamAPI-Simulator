# P6-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-12T09:56:09.402Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP6.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"intBoundarySum":-1,"intBoundaryAverage":"-0.5","intStatsCount":2,"intStatsSum":"-1L","intStatsMin":-2147483648,"intStatsMax":2147483647,"intStatsAverage":"-0.5","longBoundarySum":"0L","longStatsCount":2,"longStatsSum":"0L","longStatsMin":"-9_007_199_254_740_991L","longStatsMax":"9_007_199_254_740_991L","longStatsAverage":"0.0","doubleBoxedValues":["0.0","0.000001","1000000000000000.0"],"doubleStatsCount":3,"doubleStatsMin":"0.0","doubleStatsMax":"1000000000000000.0","employeeCount":2,"summingIntAge":95,"averagingIntAge":"47.5","summingLongSalary":99999999,"averagingLongSalary":"49999999.5","summingDoubleEvaluation":"5.0","averagingDoubleEvaluation":"2.5"}
- 実測値（JDK 25実行結果）    : {"intBoundarySum":-1,"intBoundaryAverage":"-0.5","intStatsCount":2,"intStatsSum":"-1L","intStatsMin":-2147483648,"intStatsMax":2147483647,"intStatsAverage":"-0.5","longBoundarySum":"0L","longStatsCount":2,"longStatsSum":"0L","longStatsMin":"-9_007_199_254_740_991L","longStatsMax":"9_007_199_254_740_991L","longStatsAverage":"0.0","doubleBoxedValues":["0.0","0.000001","1000000000000000.0"],"doubleStatsCount":3,"doubleStatsMin":"0.0","doubleStatsMax":"1000000000000000.0","employeeCount":2,"summingIntAge":95,"averagingIntAge":"47.5","summingLongSalary":99999999,"averagingLongSalary":"49999999.5","summingDoubleEvaluation":"5.0","averagingDoubleEvaluation":"2.5"}
- 比較方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定（64bit境界値は10進文字列のまま比較し、numberへ変換しない）
- 判定: PASS（完全一致）

## P6必須Oracle IDの結果（P6-O01・P6-O02）
- P6-O01: PASS（JDK 25実測値とSimulation Core期待値のJSON完全一致）
  - 対象は取込相当candidate（Import Contractの前段検証を通した貼付JSON）の実行結果
  - doubleはSimulation Coreのformat（formatDoubleLiteral）表記へ両側で揃えて厳密照合（JavaのDouble.toStringは1e-3未満・1e7以上で指数表記へ切り替わるため、1e-6 / 1e15をそのまま比較すると偽装不一致になる）
  - longは3桁区切り + L表記（formatLongLiteral）へ両側で揃えて厳密照合し、numberへ変換しない
  - DoubleStreamのsum / averageは照合対象外（JDKは補償付き加算、Simulation Coreのprimitive Stream集計は素朴加算のため）。double集計はCollectors側で照合する
- P6-O02: PASS（Oracle運用検証）
  - 必須6 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01）が各1件存在（欠落・重複なし）: PASS
  - 証跡書込みは現行Phase（P6）のみ（書込み先はartifacts/phase-6/oracle-result.mdだけ。P1〜P5はwriteReportPath: nullの照合のみ）: PASS
  - 実行前後でartifacts/phase-1〜phase-5のSHA-256が不変: PASS

## 過去Phase suiteの回帰結果（照合のみ・証跡書込みなし）
- P1-O01: PASS（照合のみ・証跡書込みなし）
- P2-O01: PASS（照合のみ・証跡書込みなし）
- P3-O01: PASS（照合のみ・証跡書込みなし）
- P4-O01: PASS（照合のみ・証跡書込みなし）
- P5-O01: PASS（照合のみ・証跡書込みなし）
- P4-O02（Long境界値の損失なし照合をP4 suiteへ適用）: PASS（Long.MAX_VALUE=`9223372036854775807` / Long.MIN_VALUE=`-9223372036854775808`を10進文字列のまま比較）

- 総合判定: PASS（P6-O01・P6-O02のいずれかがFAILなら総合もFAIL）

## 関連する機械検証
- P6-O01（期待値とSimulation Coreの一致）: `tests/domain/p6-oracleSync.test.ts`
- P6-O02（必須6 suite・現行Phase単独書込み・過去artifacts不変の構成検証）: `tests/domain/p6-review.test.ts`
- P5-O02（Phase 5時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p5-review.test.ts`
- P4-O02 / P4-O03（Phase 4時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p4-review.test.ts`
- 過去Phase期待値とSimulation Coreの一致: `tests/domain/p5-oracleSync.test.ts` 他
