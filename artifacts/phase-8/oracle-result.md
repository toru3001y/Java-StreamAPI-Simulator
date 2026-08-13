# P8-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-13T11:35:20.635Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP8.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"identity":["佐藤=佐藤（age=35）","田中=田中（age=29）","鈴木=鈴木（age=27）","高橋=高橋（age=42）"],"identityEmpty":[],"duplicateExceptionType":"IllegalStateException","duplicateKey":"関東","duplicateExistingValue":"\"伊藤\"","duplicateIncomingValue":"\"渡辺\"","mergeFirst":["中部=\"小林\"","関東=\"伊藤\"","関西=\"中村\""],"mergeLast":["中部=\"小林\"","関東=\"山本\"","関西=\"中村\""],"mergeConcat":["中部=\"小林\"","関東=\"伊藤, 渡辺, 山本\"","関西=\"中村\""],"groupingByMergeDemo":["中部=[小林（age=30）]","関東=[伊藤（age=31）, 渡辺（age=38）, 山本（age=26）]","関西=[中村（age=33）]"],"treeMapOrdered":["中部=4_800_000L","関東=5_500_000L","関西=4_200_000L"],"treeMapEmpty":[],"groupedToMap":["中部={田中=4_800_000L}","関東={佐藤=5_500_000L, 高橋=7_200_000L}","関西={鈴木=4_200_000L}"],"partitionFalseEmpty":[],"partitionTrue":["佐藤=5_500_000L","田中=4_800_000L","鈴木=4_200_000L","高橋=7_200_000L"],"teeingToMapByRegion":"{中部=\"小林\", 関東=\"伊藤\", 関西=\"中村\"}","teeingToMapCount":"5"}
- 実測値（JDK 25実行結果）    : {"identity":["佐藤=佐藤（age=35）","田中=田中（age=29）","鈴木=鈴木（age=27）","高橋=高橋（age=42）"],"identityEmpty":[],"duplicateExceptionType":"IllegalStateException","duplicateKey":"関東","duplicateExistingValue":"\"伊藤\"","duplicateIncomingValue":"\"渡辺\"","mergeFirst":["中部=\"小林\"","関東=\"伊藤\"","関西=\"中村\""],"mergeLast":["中部=\"小林\"","関東=\"山本\"","関西=\"中村\""],"mergeConcat":["中部=\"小林\"","関東=\"伊藤, 渡辺, 山本\"","関西=\"中村\""],"groupingByMergeDemo":["中部=[小林（age=30）]","関東=[伊藤（age=31）, 渡辺（age=38）, 山本（age=26）]","関西=[中村（age=33）]"],"treeMapOrdered":["中部=4_800_000L","関東=5_500_000L","関西=4_200_000L"],"treeMapEmpty":[],"groupedToMap":["中部={田中=4_800_000L}","関東={佐藤=5_500_000L, 高橋=7_200_000L}","関西={鈴木=4_200_000L}"],"partitionFalseEmpty":[],"partitionTrue":["佐藤=5_500_000L","田中=4_800_000L","鈴木=4_200_000L","高橋=7_200_000L"],"teeingToMapByRegion":"{中部=\"小林\", 関東=\"伊藤\", 関西=\"中村\"}","teeingToMapCount":"5"}
- 比較方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定（64bit境界値は10進文字列のまま比較し、numberへ変換しない）
- 判定: PASS（完全一致）

## 観測記録（厳密比較の対象外。JDKの保証として扱わない）
- toMap2Arg.exceptionMessage=Duplicate key 関東 (attempted merging values 伊藤 and 渡辺)
- toMap3Arg.mergeCallOrder=merge(伊藤, 渡辺) | merge(伊藤, 渡辺, 山本)
- toMap3Arg.mergeLoggedResult=伊藤, 渡辺, 山本
- toMap2Arg.returnedMapClass=HashMap
- toMap4Arg.returnedMapClass=TreeMap
- partitioningBy.keySet=[false, true]

## P8必須Oracle IDの結果（P8-O01・P8-O02）
- P8-O01: PASS（JDK 25実測値とSimulation Core期待値のJSON完全一致）
  - 対象は§8.2の10ケース（standard 8 + emptySource 2）の実行結果と、partitioningBy空partitionの追加照合、およびv0.12のteeing(toMap(region, name, first, TreeMap::new), counting(), RegionIndex::new)（teeing branchへのtoMap配置。左branchはTreeMapのため実entry順で厳密比較）
  - 順序保証のないMap（2・3引数版toMap・groupingBy）はキーの表示文字列の辞書順へ**正規化**してから照合する（返却Mapのentry反復順序はJDKの保証対象外であり照合契約にしない。正規化は比較のためだけであり、iteration order保証を意味しない）
  - TreeMap（4引数版）だけは実entry順（中部 → 関東 → 関西）を厳密比較する（順序自体が検証対象）
  - encounter order・mergeの適用順は返却Mapの反復順ではなく**結果値**で検証する（first / lastの結果差〔伊藤 / 山本〕が「(既存値, 新しい値)」の適用順を、concatの連結順〔伊藤, 渡辺, 山本〕が順次適用のencounter orderを実証する）
  - 2引数版の重複キーは例外**型のみ**を契約として照合する（assertThrows(IllegalStateException.class, …)相当）。実測の例外メッセージはOBSERVATION行として観測記録に保存し、厳密比較の対象にしない
  - mergeFunctionの呼出し順はOBSERVATION行として記録し、厳密比較の対象にしない
  - longは3桁区切り + L表記（formatLongLiteral）へ両側で揃えて厳密照合し、numberへ変換しない。Employee要素はCoreのformatSimValueと同じ`氏名（age=NN）`表記、String値はクォート付き表記へ揃える
- P8-O02: PASS（Oracle運用検証）
  - 必須8 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01 / P6-O01 / P7-O01 / P8-O01）が各1件存在（欠落・重複なし）: PASS
  - 証跡書込みは現行Phase（P8）のみ（書込み先はartifacts/phase-8/oracle-result.mdだけ。P1〜P7はwriteReportPath: nullの照合のみ）: PASS
  - 実行前後でartifacts/phase-1〜phase-7のSHA-256が不変: PASS

## 過去Phase suiteの回帰結果（照合のみ・証跡書込みなし）
- P1-O01: PASS（照合のみ・証跡書込みなし）
- P2-O01: PASS（照合のみ・証跡書込みなし）
- P3-O01: PASS（照合のみ・証跡書込みなし）
- P4-O01: PASS（照合のみ・証跡書込みなし）
- P5-O01: PASS（照合のみ・証跡書込みなし）
- P6-O01: PASS（照合のみ・証跡書込みなし）
- P7-O01: PASS（照合のみ・証跡書込みなし）
- P4-O02（Long境界値の損失なし照合をP4 suiteへ適用）: PASS（Long.MAX_VALUE=`9223372036854775807` / Long.MIN_VALUE=`-9223372036854775808`を10進文字列のまま比較）

- 総合判定: PASS（P8-O01・P8-O02のいずれかがFAILなら総合もFAIL）

## 関連する機械検証
- P8-O01（期待値とSimulation Coreの一致）: `tests/domain/p8-oracleSync.test.ts`
- P8-O02（必須8 suite・現行Phase単独書込み・過去artifacts不変の構成検証）: `tests/domain/p8-review.test.ts`
- P7-O02（Phase 7時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p7-review.test.ts`
- P6-O02（Phase 6時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p6-review.test.ts`
- P5-O02（Phase 5時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p5-review.test.ts`
- P4-O02 / P4-O03（Phase 4時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p4-review.test.ts`
- 過去Phase期待値とSimulation Coreの一致: `tests/domain/p6-oracleSync.test.ts` 他
