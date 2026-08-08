# P2-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-08T02:14:02.374Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP2.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"collectionNames":["佐藤","鈴木","高橋","田中"],"arraysUpper":["JAVA","SQL","WEB"],"arraysInt":[3,1,4],"streamOfUpper":["JAVA","SQL"],"iterate3":[1,2,3,4,5],"range":[1,2,3,4],"rangeClosed":[1,2,3,4,5],"ages":[35,27,42,29],"salaries":[5500000,4200000,7200000,4800000],"evaluations":[4.2,3.8,4.6,4],"boxedRange":[1,2,3],"mapToObj":["No.1","No.2","No.3"],"flatten":["Java","SQL","分析"],"flattenInt":[1,2,3],"flattenLong":[10,20,30],"flattenDouble":[1.5,2.5,3.5],"emptyObject":[],"emptyInt":[],"emptyLong":[],"emptyDouble":[],"agesElementType":"Integer","salariesElementType":"Long","evaluationsElementType":"Double","mapToObjElementType":"String","flattenIntElementType":"Integer"}
- 実測値（JDK 25実行結果）    : {"collectionNames":["佐藤","鈴木","高橋","田中"],"arraysUpper":["JAVA","SQL","WEB"],"arraysInt":[3,1,4],"streamOfUpper":["JAVA","SQL"],"iterate3":[1,2,3,4,5],"range":[1,2,3,4],"rangeClosed":[1,2,3,4,5],"ages":[35,27,42,29],"salaries":[5500000,4200000,7200000,4800000],"evaluations":[4.2,3.8,4.6,4],"boxedRange":[1,2,3],"mapToObj":["No.1","No.2","No.3"],"flatten":["Java","SQL","分析"],"flattenInt":[1,2,3],"flattenLong":[10,20,30],"flattenDouble":[1.5,2.5,3.5],"emptyObject":[],"emptyInt":[],"emptyLong":[],"emptyDouble":[],"agesElementType":"Integer","salariesElementType":"Long","evaluationsElementType":"Double","mapToObjElementType":"String","flattenIntElementType":"Integer"}
- 判定: PASS（完全一致）
