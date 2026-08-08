# P3-O01 JDK 25 Oracle Test 結果

実行日時: 2026-08-08T10:35:13.263Z
Dockerイメージ: gradle:9.6.1-jdk25
対象: OracleP3.java

## java -version
```
openjdk version "25.0.3" 2026-04-21 LTS
OpenJDK Runtime Environment Temurin-25.0.3+9 (build 25.0.3+9-LTS)
OpenJDK 64-Bit Server VM Temurin-25.0.3+9 (build 25.0.3+9-LTS, mixed mode, sharing)
```

## 照合結果
- 期待値（Simulation Core由来）: {"distinct":["Java","SQL","Git"],"distinctKeptIndices":[0,1,3],"sortedNatural":["API","Git","Java","SQL"],"sortedComparatorNames":["田中","佐藤","高橋","鈴木"],"limitStandard":[1,2,3],"limitZero":[],"limitEqual":[1,2,3],"limitOver":[1,2],"skipStandard":[30,40],"skipZero":[10,20,30,40],"skipAll":[],"takeWhileStandard":[1,2],"takeWhileFirstFalse":[],"dropWhileStandard":[6,3,7],"dropWhileAllTrue":[],"generateLimit":[1,2,3],"generateSupplierCalls":3,"iterateLimit":[1,2,3,4,5],"peekResultNames":["佐藤","鈴木","高橋","田中"],"peekActions":["佐藤","鈴木","高橋","田中"],"intSorted":[1,2,3],"longSorted":[10,20,30],"doubleSorted":[1.5,2.5,3.5],"doubleDistinct":[2.5,1.5],"emptyDistinct":[],"emptySorted":[],"emptyLimit":[],"emptySkip":[],"emptyTakeWhile":[],"emptyDropWhile":[],"emptyPeek":[],"emptyPeekActionCount":0}
- 実測値（JDK 25実行結果）    : {"distinct":["Java","SQL","Git"],"distinctKeptIndices":[0,1,3],"sortedNatural":["API","Git","Java","SQL"],"sortedComparatorNames":["田中","佐藤","高橋","鈴木"],"limitStandard":[1,2,3],"limitZero":[],"limitEqual":[1,2,3],"limitOver":[1,2],"skipStandard":[30,40],"skipZero":[10,20,30,40],"skipAll":[],"takeWhileStandard":[1,2],"takeWhileFirstFalse":[],"dropWhileStandard":[6,3,7],"dropWhileAllTrue":[],"generateLimit":[1,2,3],"generateSupplierCalls":3,"iterateLimit":[1,2,3,4,5],"peekResultNames":["佐藤","鈴木","高橋","田中"],"peekActions":["佐藤","鈴木","高橋","田中"],"intSorted":[1,2,3],"longSorted":[10,20,30],"doubleSorted":[1.5,2.5,3.5],"doubleDistinct":[2.5,1.5],"emptyDistinct":[],"emptySorted":[],"emptyLimit":[],"emptySkip":[],"emptyTakeWhile":[],"emptyDropWhile":[],"emptyPeek":[],"emptyPeekActionCount":0}
- 判定: PASS（完全一致）
