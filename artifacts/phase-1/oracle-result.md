# P1-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-08T01:40:16.567Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP1.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"standard":["佐藤","高橋"],"midEmpty":[],"emptySource":[],"chain":["高橋"],"standardUnmodifiable":true}
- 実測値（JDK 25実行結果）    : {"standard":["佐藤","高橋"],"midEmpty":[],"emptySource":[],"chain":["高橋"],"standardUnmodifiable":true}
- 判定: PASS（完全一致）
