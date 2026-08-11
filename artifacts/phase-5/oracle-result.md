# P5-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-11T19:32:33.312Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP5.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"toList":["佐藤","鈴木","高橋","田中"],"toListEmpty":[],"toSet":["中部","関東","関西"],"toSetEmpty":[],"toCollection":["佐藤","鈴木","高橋","田中"],"toCollectionEmpty":[],"joining":"佐藤鈴木高橋田中","joiningEmpty":"","joiningDelimiter":"佐藤, 鈴木, 高橋, 田中","joiningDelimiterEmpty":"","joiningFull":"[佐藤, 鈴木, 高橋, 田中]","joiningFullEmpty":"[]","counting":4,"countingEmpty":0,"summingInt":133,"summingIntEmpty":0,"summingLong":21700000,"summingLongEmpty":0,"summingDouble":"16.6","summingDoubleEmpty":"0.0","averagingInt":"33.25","averagingIntEmpty":"0.0","averagingLong":"5425000.0","averagingLongEmpty":"0.0","averagingDouble":"4.15","averagingDoubleEmpty":"0.0","statsInt":[4,133,27,42,"33.25"],"statsIntEmpty":[0,0,2147483647,-2147483648,"0.0"],"statsLong":[4,21700000,4200000,7200000,"5425000.0"],"statsLongEmpty":[0,0,"9223372036854775807","-9223372036854775808","0.0"],"statsDouble":[4,"16.6","3.8","4.6","4.15"],"statsDoubleEmpty":[0,"0.0","Infinity","-Infinity","0.0"],"minByName":"鈴木","minByEmptyPresent":false,"maxByName":"高橋","maxByEmptyPresent":false,"reducing":"佐藤鈴木高橋田中","reducingEmptyPresent":false,"mapping":[["営業部",["鈴木","田中"]],["開発部",["佐藤","高橋"]]],"filtering":[["営業部",[]],["開発部",["佐藤","高橋"]]],"flatMapping":[["営業部",["営業","英語","SQL","分析"]],["開発部",["Java","SQL","Java","設計"]]],"collectingAndThen":["佐藤","鈴木","高橋","田中"],"collectingAndThenEmpty":[],"groupingByDepartment":[["Department[name=営業部, division=営業本部]",["鈴木","田中"]],["Department[name=開発部, division=技術本部]",["佐藤","高橋"]]],"groupingByDepartmentEmpty":[],"groupingByCounting":[["中部",1],["関東",2],["関西",1]],"groupingByAveraging":[["中部","4800000.0"],["関東","6350000.0"],["関西","4200000.0"]],"groupingByTreeMapOrdered":[["中部",["田中"]],["関東",["佐藤","高橋"]],["関西",["鈴木"]]],"nestedGroupingBy":[["Department[name=営業部, division=営業本部]",[["中部",["田中"]],["関西",["鈴木"]]]],["Department[name=開発部, division=技術本部]",[["関東",["佐藤","高橋"]]]]],"partitioningBy":[["false",["鈴木","田中"]],["true",["佐藤","高橋"]]],"partitioningByEmpty":[["false",[]],["true",[]]],"partitioningByCounting":[["false",2],["true",2]],"partitioningByCountingEmpty":[["false",0],["true",0]],"teeingCount":4,"teeingAverage":"5425000.0","teeingEmptyCount":0,"teeingEmptyAverage":"0.0","teeingRecordToString":"SalarySummary[employeeCount=4, averageSalary=5425000.0]","teeingEmptyRecordToString":"SalarySummary[employeeCount=0, averageSalary=0.0]","collectTriple":["佐藤","鈴木","高橋","田中"],"collectTripleEmpty":[],"takeWhileSalary":["佐藤"],"dropWhileSalary":["鈴木","高橋","田中"],"compensatedSums":["0.011000000000000001","4.0","0.6"],"naiveSums":["0.011","0.0","0.6000000000000001"],"compensatedAverages":["0.0055000000000000005","0.8","0.19999999999999998"],"compensatedStatsSums":["0.011000000000000001","4.0","0.6"]}
- 実測値（JDK 25実行結果）    : {"toList":["佐藤","鈴木","高橋","田中"],"toListEmpty":[],"toSet":["中部","関東","関西"],"toSetEmpty":[],"toCollection":["佐藤","鈴木","高橋","田中"],"toCollectionEmpty":[],"joining":"佐藤鈴木高橋田中","joiningEmpty":"","joiningDelimiter":"佐藤, 鈴木, 高橋, 田中","joiningDelimiterEmpty":"","joiningFull":"[佐藤, 鈴木, 高橋, 田中]","joiningFullEmpty":"[]","counting":4,"countingEmpty":0,"summingInt":133,"summingIntEmpty":0,"summingLong":21700000,"summingLongEmpty":0,"summingDouble":"16.6","summingDoubleEmpty":"0.0","averagingInt":"33.25","averagingIntEmpty":"0.0","averagingLong":"5425000.0","averagingLongEmpty":"0.0","averagingDouble":"4.15","averagingDoubleEmpty":"0.0","statsInt":[4,133,27,42,"33.25"],"statsIntEmpty":[0,0,2147483647,-2147483648,"0.0"],"statsLong":[4,21700000,4200000,7200000,"5425000.0"],"statsLongEmpty":[0,0,"9223372036854775807","-9223372036854775808","0.0"],"statsDouble":[4,"16.6","3.8","4.6","4.15"],"statsDoubleEmpty":[0,"0.0","Infinity","-Infinity","0.0"],"minByName":"鈴木","minByEmptyPresent":false,"maxByName":"高橋","maxByEmptyPresent":false,"reducing":"佐藤鈴木高橋田中","reducingEmptyPresent":false,"mapping":[["営業部",["鈴木","田中"]],["開発部",["佐藤","高橋"]]],"filtering":[["営業部",[]],["開発部",["佐藤","高橋"]]],"flatMapping":[["営業部",["営業","英語","SQL","分析"]],["開発部",["Java","SQL","Java","設計"]]],"collectingAndThen":["佐藤","鈴木","高橋","田中"],"collectingAndThenEmpty":[],"groupingByDepartment":[["Department[name=営業部, division=営業本部]",["鈴木","田中"]],["Department[name=開発部, division=技術本部]",["佐藤","高橋"]]],"groupingByDepartmentEmpty":[],"groupingByCounting":[["中部",1],["関東",2],["関西",1]],"groupingByAveraging":[["中部","4800000.0"],["関東","6350000.0"],["関西","4200000.0"]],"groupingByTreeMapOrdered":[["中部",["田中"]],["関東",["佐藤","高橋"]],["関西",["鈴木"]]],"nestedGroupingBy":[["Department[name=営業部, division=営業本部]",[["中部",["田中"]],["関西",["鈴木"]]]],["Department[name=開発部, division=技術本部]",[["関東",["佐藤","高橋"]]]]],"partitioningBy":[["false",["鈴木","田中"]],["true",["佐藤","高橋"]]],"partitioningByEmpty":[["false",[]],["true",[]]],"partitioningByCounting":[["false",2],["true",2]],"partitioningByCountingEmpty":[["false",0],["true",0]],"teeingCount":4,"teeingAverage":"5425000.0","teeingEmptyCount":0,"teeingEmptyAverage":"0.0","teeingRecordToString":"SalarySummary[employeeCount=4, averageSalary=5425000.0]","teeingEmptyRecordToString":"SalarySummary[employeeCount=0, averageSalary=0.0]","collectTriple":["佐藤","鈴木","高橋","田中"],"collectTripleEmpty":[],"takeWhileSalary":["佐藤"],"dropWhileSalary":["鈴木","高橋","田中"],"compensatedSums":["0.011000000000000001","4.0","0.6"],"naiveSums":["0.011","0.0","0.6000000000000001"],"compensatedAverages":["0.0055000000000000005","0.8","0.19999999999999998"],"compensatedStatsSums":["0.011000000000000001","4.0","0.6"]}
- 比較方式: JSON.parse後のオブジェクトをJSON.stringifyし文字列完全一致で判定（64bit境界値は10進文字列のまま比較し、numberへ変換しない）
- 判定: PASS（完全一致）

## 観測記録（厳密比較の対象外。JDKの保証として扱わない）
- groupingByMapClass=HashMap（groupingByの返却Map型はJDKの保証対象ではない）
- toSetClass=HashSet（toSetの返却Set型・iteration orderはJDKの保証対象ではない）
- collectorsToListMutable=true（Collectors.toList()の可変性は保証されない。Stream.toList()はunmodifiable）

## P5必須Oracle IDの結果（P5-O01・P5-O02）
- P5-O01: PASS（JDK 25実測値とSimulation Core期待値のJSON完全一致）
  - unordered結果の比較正規化: 順序意味論を持たないSet / Mapはキー・要素の表示文字列の辞書順へ正規化してから照合（正規化は比較のためだけであり、JDKのiteration order保証を意味しない）
  - TreeMap（順序意味論あり）は正規化せず実順序のまま照合（順序自体が検証対象）
  - 数値は正規化後もJSON文字列表現で厳密照合（64bit境界値・±Infinityは10進文字列のまま比較）
- P5-O02: PASS（Oracle運用検証）
  - 必須5 suite（P1-O01 / P2-O01 / P3-O01 / P4-O01 / P5-O01）が各1件存在（欠落・重複なし）: PASS
  - 証跡書込みは現行Phase（P5）のみ（書込み先はartifacts/phase-5/oracle-result.mdだけ。P1〜P4はwriteReportPath: nullの照合のみ）: PASS
  - 実行前後でartifacts/phase-1〜phase-4のSHA-256が不変: PASS

## 過去Phase suiteの回帰結果（照合のみ・証跡書込みなし）
- P1-O01: PASS（照合のみ・証跡書込みなし）
- P2-O01: PASS（照合のみ・証跡書込みなし）
- P3-O01: PASS（照合のみ・証跡書込みなし）
- P4-O01: PASS（照合のみ・証跡書込みなし）
- P4-O02（Long境界値の損失なし照合をP4 suiteへ適用）: PASS（Long.MAX_VALUE=`9223372036854775807` / Long.MIN_VALUE=`-9223372036854775808`を10進文字列のまま比較）

- 総合判定: PASS（P5-O01・P5-O02のいずれかがFAILなら総合もFAIL）

## 関連する機械検証
- P5-O01（期待値とSimulation Coreの一致・unordered正規化）: `tests/domain/p5-oracleSync.test.ts`
- P5-O02（必須5 suite・現行Phase単独書込み・過去artifacts不変の構成検証）: `tests/domain/p5-review.test.ts`
- P4-O02 / P4-O03（Phase 4時点のsuite構成契約をfixtureで固定して検証）: `tests/domain/p4-review.test.ts`
- 過去Phase期待値とSimulation Coreの一致: `tests/domain/p4-oracleSync.test.ts` 他
