import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * P8-O01: Phase 8 Collectors.toMap実行の JDK 25 Oracle Test。
 *
 * 製品コードとは独立した固定Java 25コードで期待結果を実測し、
 * Simulation Core由来の期待値（expected-p8-from-core.json）と照合する。
 *
 * 対象は Phase 8指示 §8.2 の10ケース（standard 8 + emptySource 2）と、
 * v0.11 §3.3・§7の追加照合（partitioningBy配下の空partition）:
 *   1. toMap(Employee::name, Function.identity())（Employee 4件。全キー一意）
 *   2. 同上（空）
 *   3. toMap(Employee::region, Employee::name)（mergeDemo 5件。関東3件で重複 → IllegalStateException）
 *   4. toMap(region, name, (a, b) -> a)（first）
 *   5. toMap(region, name, (a, b) -> b)（last）
 *   6. toMap(region, name, (s, a) -> s + ", " + a)（concat。3件衝突の順次適用）
 *   7. toMap(region, salary, (a, b) -> a, TreeMap::new)（Employee 4件。キー昇順）
 *   8. 同上（空。TreeMap）
 *   9. groupingBy(region, toMap(name, salary))（bucketごとの独立蓄積）
 *  10. groupingBy(region)（同一データのgroupingBy比較。1キー多値）
 *  +   partitioningBy(e -> e.age() >= 0, toMap(name, salary, first, TreeMap::new))
 *      （要素0件のfalse partitionも空TreeMapが値になる）
 *  +   v0.12: teeing(toMap(region, name, first, TreeMap::new), counting(), RegionIndex::new)
 *      （teeing branchへのtoMap配置。左branchはTreeMapのため実entry順で厳密比較）
 *
 * 照合方式（Phase 5〜7で確立した方式の踏襲。指示§12.5）:
 *   - **順序保証のないMap**（2・3引数版toMap・groupingBy）はキーの表示文字列の**辞書順へ正規化**して
 *     から比較する（返却Mapのentry反復順序はJDKの保証対象外であり照合契約にしない。
 *     正規化は比較のためだけであり、iteration order保証を意味しない）。
 *   - **TreeMap（4引数版）だけは実entry順**をそのまま出力して厳密比較する（順序自体が検証対象）。
 *   - **encounter order・mergeの適用順は反復順ではなく結果値で検証する**:
 *     first / lastの結果差（伊藤 / 山本）が「(既存値, 新しい値)」の適用順を、
 *     concatの連結順（伊藤, 渡辺, 山本）が順次適用のencounter orderを実証する。
 *   - **2引数版の重複キーは例外型のみ**を契約として照合する
 *     （assertThrows(IllegalStateException.class, …)相当）。実測の例外メッセージは
 *     `OBSERVATION:`接頭辞の観測記録として保存し、厳密比較の対象にしない。
 *   - mergeFunctionの呼出し順もOBSERVATION行として記録し、厳密比較の対象にしない。
 *
 * 数値・値の表記合わせ（Simulation Coreのformat表記へ揃える）:
 *   - long は {@link #longLiteral(long)}（3桁区切り + L。Coreの formatLongLiteral と同一規則）。
 *   - Employee要素は Core の formatSimValue と同じ `氏名（age=NN）` 表記。
 *   - String値は Core と同じクォート付き表記。
 *   - Map entryは `キー=値`（キーは生の文字列、値は上記表記）。
 */
public class OracleP8 {

    record Department(String name, String division) {}

    record Employee(
            String name,
            int age,
            long salary,
            double evaluation,
            String region,
            LocalDate hireDate,
            Department department,
            List<String> skills) {}

    /** v0.12: teeing merger record（Simulation Coreの`RegionIndex::new`と同形） */
    record RegionIndex(Map<String, String> byRegion, long count) {}

    private static String jsonString(String value) {
        StringBuilder sb = new StringBuilder("\"");
        for (int i = 0; i < value.length(); i++) {
            char ch = value.charAt(i);
            switch (ch) {
                case '\\' -> sb.append("\\\\");
                case '"' -> sb.append("\\\"");
                case '\n' -> sb.append("\\n");
                case '\r' -> sb.append("\\r");
                case '\t' -> sb.append("\\t");
                default -> sb.append(ch);
            }
        }
        return sb.append('"').toString();
    }

    private static String jsonStrings(List<String> values) {
        return values.stream().map(OracleP8::jsonString).collect(Collectors.joining(",", "[", "]"));
    }

    /** Simulation Coreの`formatLongLiteral`と同一の3桁区切り + L表記を生成する。 */
    private static String longLiteral(long value) {
        boolean negative = value < 0;
        String digits = Long.toString(Math.abs(value));
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < digits.length(); i++) {
            int posFromEnd = digits.length() - i;
            sb.append(digits.charAt(i));
            if (posFromEnd > 1 && (posFromEnd - 1) % 3 == 0) {
                sb.append('_');
            }
        }
        return (negative ? "-" : "") + sb + "L";
    }

    /** Coreの`formatSimValue`（employee variant）と同じ表記 */
    private static String employeeLabel(Employee e) {
        return e.name() + "（age=" + e.age() + "）";
    }

    /** Coreの`formatSimValue`（string variant）と同じ表記 */
    private static String stringLabel(String s) {
        return "\"" + s + "\"";
    }

    /** Map entryを`キー=値`の文字列へ整形する */
    private static <K, V> List<String> pairs(Map<K, V> map, Function<V, String> valueLabel) {
        List<String> out = new ArrayList<>();
        for (Map.Entry<K, V> entry : map.entrySet()) {
            out.add(entry.getKey() + "=" + valueLabel.apply(entry.getValue()));
        }
        return out;
    }

    /**
     * 順序保証のないMapの比較正規化。キーの表示文字列（= `キー=値`の文字列）の辞書順へ揃える。
     * 正規化は比較のためだけであり、JDKのiteration order保証を意味しない。
     */
    private static List<String> normalized(List<String> entryPairs) {
        List<String> sorted = new ArrayList<>(entryPairs);
        sorted.sort(String::compareTo);
        return sorted;
    }

    /** nested Map（groupingBy + toMap）の値を`{k=v, k=v}`へ整形する（内側も正規化） */
    private static String nestedMapLabel(Map<String, Long> inner) {
        return "{" + String.join(", ", normalized(pairs(inner, OracleP8::longLiteral))) + "}";
    }

    /** List<Employee>の値を`[要素1, 要素2]`へ整形する（CoreのformatSimValueの再帰整形と同じ） */
    private static String employeeListLabel(List<Employee> list) {
        return "[" + list.stream().map(OracleP8::employeeLabel).collect(Collectors.joining(", ")) + "]";
    }

    public static void main(String[] args) {
        Department development = new Department("開発部", "技術本部");
        Department sales = new Department("営業部", "営業本部");

        // Phase 1からの基準fixture（Draft v0.8 §21.3）
        List<Employee> employees = List.of(
                new Employee("佐藤", 35, 5_500_000L, 4.2, "関東",
                        LocalDate.of(2022, 4, 1), development, List.of("Java", "SQL")),
                new Employee("鈴木", 27, 4_200_000L, 3.8, "関西",
                        LocalDate.of(2023, 10, 1), sales, List.of("営業", "英語")),
                new Employee("高橋", 42, 7_200_000L, 4.6, "関東",
                        LocalDate.of(2018, 7, 15), development, List.of("Java", "設計")),
                new Employee("田中", 29, 4_800_000L, 4.0, "中部",
                        LocalDate.of(2021, 1, 5), sales, List.of("SQL", "分析")));

        // Phase 8のmerge実演用データセット（関東3件。Phase 8指示 §7.6）
        List<Employee> employeesMergeDemo = List.of(
                new Employee("伊藤", 31, 5_000_000L, 4.1, "関東",
                        LocalDate.of(2020, 4, 1), development, List.of("Java", "AWS")),
                new Employee("渡辺", 38, 6_100_000L, 4.4, "関東",
                        LocalDate.of(2016, 10, 1), development, List.of("設計", "SQL")),
                new Employee("山本", 26, 4_600_000L, 3.9, "関東",
                        LocalDate.of(2024, 4, 1), sales, List.of("営業", "SQL")),
                new Employee("中村", 33, 5_200_000L, 4.0, "関西",
                        LocalDate.of(2019, 7, 1), sales, List.of("営業", "英語")),
                new Employee("小林", 30, 4_900_000L, 3.7, "中部",
                        LocalDate.of(2021, 10, 1), development, List.of("Java", "分析")));

        List<Employee> noEmployees = List.of();

        // ---- 1 / 2. 2引数版・value側identity（公式API Note の典型形） ----
        Map<String, Employee> identity =
                employees.stream().collect(Collectors.toMap(Employee::name, Function.identity()));
        Map<String, Employee> identityEmpty =
                noEmployees.stream().collect(Collectors.toMap(Employee::name, Function.identity()));

        // ---- 3. 2引数版・重複キー（例外型のみを契約として照合する） ----
        String duplicateExceptionType;
        String duplicateExceptionMessage;
        try {
            Map<String, String> unreachable = employeesMergeDemo.stream()
                    .collect(Collectors.toMap(Employee::region, Employee::name));
            duplicateExceptionType = "NO_EXCEPTION(size=" + unreachable.size() + ")";
            duplicateExceptionMessage = "";
        } catch (IllegalStateException e) {
            duplicateExceptionType = e.getClass().getSimpleName();
            duplicateExceptionMessage = String.valueOf(e.getMessage());
        }
        // 衝突したキーと2値は、JDK内部の評価順に依存しない形でこの固定コードから導出する
        // （encounter orderで最初に重複するキーと、その1件目 / 2件目の値）。
        // 例外メッセージ全文は照合契約に含めない（OBSERVATIONとして観測記録に残す）。
        String duplicateKey = "";
        String duplicateExistingValue = "";
        String duplicateIncomingValue = "";
        Set<String> seenRegions = new LinkedHashSet<>();
        Map<String, String> firstValueByRegion = new java.util.LinkedHashMap<>();
        for (Employee e : employeesMergeDemo) {
            if (!seenRegions.add(e.region())) {
                if (duplicateKey.isEmpty()) {
                    duplicateKey = e.region();
                    duplicateExistingValue = stringLabel(firstValueByRegion.get(e.region()));
                    duplicateIncomingValue = stringLabel(e.name());
                }
            } else {
                firstValueByRegion.put(e.region(), e.name());
            }
        }

        // ---- 4 / 5 / 6. 3引数版merge（同一データ・同一keyMapper） ----
        Map<String, String> mergeFirst = employeesMergeDemo.stream()
                .collect(Collectors.toMap(Employee::region, Employee::name, (a, b) -> a));
        Map<String, String> mergeLast = employeesMergeDemo.stream()
                .collect(Collectors.toMap(Employee::region, Employee::name, (a, b) -> b));
        Map<String, String> mergeConcat = employeesMergeDemo.stream()
                .collect(Collectors.toMap(Employee::region, Employee::name, (s, a) -> s + ", " + a));

        // ---- 10. 同一データのgroupingBy比較（1キー多値） ----
        Map<String, List<Employee>> groupingByMergeDemo =
                employeesMergeDemo.stream().collect(Collectors.groupingBy(Employee::region));

        // ---- 7 / 8. 4引数版TreeMap（キー昇順。実entry順を厳密比較する） ----
        TreeMap<String, Long> treeMapOrdered = employees.stream()
                .collect(Collectors.toMap(Employee::region, Employee::salary, (a, b) -> a, TreeMap::new));
        TreeMap<String, Long> treeMapEmpty = noEmployees.stream()
                .collect(Collectors.toMap(Employee::region, Employee::salary, (a, b) -> a, TreeMap::new));

        // ---- 9. downstream形（bucketごとの独立蓄積・nested Map） ----
        Map<String, Map<String, Long>> groupedToMap = employees.stream()
                .collect(Collectors.groupingBy(
                        Employee::region,
                        Collectors.toMap(Employee::name, Employee::salary)));

        // ---- 追加照合: partitioningBy配下の4引数版（要素0件のpartitionも空TreeMapが値になる） ----
        Map<Boolean, TreeMap<String, Long>> partitioned = employees.stream()
                .collect(Collectors.partitioningBy(
                        e -> e.age() >= 0,
                        Collectors.toMap(Employee::name, Employee::salary, (a, b) -> a, TreeMap::new)));

        // ---- v0.12: teeing branchへのtoMap配置（画面表示のcollect式と同一形） ----
        RegionIndex regionIndex = employeesMergeDemo.stream()
                .collect(Collectors.teeing(
                        Collectors.toMap(Employee::region, Employee::name, (a, b) -> a, TreeMap::new),
                        Collectors.counting(),
                        RegionIndex::new));
        // 左branchはTreeMapのため実entry順のまま`{k=v, …}`へ整形（CoreのresultLabelOfと同一表記）
        String teeingToMapByRegion =
                "{" + String.join(", ", pairs(regionIndex.byRegion(), OracleP8::stringLabel)) + "}";
        String teeingToMapCount = Long.toString(regionIndex.count());

        // ---- OBSERVATION（厳密比較の対象外。JDKの保証として扱わない） ----
        System.out.println("OBSERVATION: toMap2Arg.exceptionMessage=" + duplicateExceptionMessage);
        List<String> mergeCallOrder = new ArrayList<>();
        Map<String, String> mergeLogged = employeesMergeDemo.stream()
                .collect(Collectors.toMap(Employee::region, Employee::name, (a, b) -> {
                    mergeCallOrder.add("merge(" + a + ", " + b + ")");
                    return a + ", " + b;
                }));
        System.out.println("OBSERVATION: toMap3Arg.mergeCallOrder=" + String.join(" | ", mergeCallOrder));
        System.out.println("OBSERVATION: toMap3Arg.mergeLoggedResult=" + mergeLogged.get("関東"));
        System.out.println("OBSERVATION: toMap2Arg.returnedMapClass="
                + identity.getClass().getSimpleName());
        System.out.println("OBSERVATION: toMap4Arg.returnedMapClass="
                + treeMapOrdered.getClass().getSimpleName());
        System.out.println("OBSERVATION: partitioningBy.keySet=" + partitioned.keySet());

        StringBuilder json = new StringBuilder("{");
        json.append("\"identity\":")
                .append(jsonStrings(normalized(pairs(identity, OracleP8::employeeLabel))));
        json.append(",\"identityEmpty\":")
                .append(jsonStrings(normalized(pairs(identityEmpty, OracleP8::employeeLabel))));
        json.append(",\"duplicateExceptionType\":").append(jsonString(duplicateExceptionType));
        json.append(",\"duplicateKey\":").append(jsonString(duplicateKey));
        json.append(",\"duplicateExistingValue\":").append(jsonString(duplicateExistingValue));
        json.append(",\"duplicateIncomingValue\":").append(jsonString(duplicateIncomingValue));
        json.append(",\"mergeFirst\":")
                .append(jsonStrings(normalized(pairs(mergeFirst, OracleP8::stringLabel))));
        json.append(",\"mergeLast\":")
                .append(jsonStrings(normalized(pairs(mergeLast, OracleP8::stringLabel))));
        json.append(",\"mergeConcat\":")
                .append(jsonStrings(normalized(pairs(mergeConcat, OracleP8::stringLabel))));
        json.append(",\"groupingByMergeDemo\":")
                .append(jsonStrings(normalized(pairs(groupingByMergeDemo, OracleP8::employeeListLabel))));
        // TreeMapは正規化せず実entry順のまま（順序自体が検証対象）
        json.append(",\"treeMapOrdered\":")
                .append(jsonStrings(pairs(treeMapOrdered, OracleP8::longLiteral)));
        json.append(",\"treeMapEmpty\":")
                .append(jsonStrings(pairs(treeMapEmpty, OracleP8::longLiteral)));
        json.append(",\"groupedToMap\":")
                .append(jsonStrings(normalized(pairs(groupedToMap, OracleP8::nestedMapLabel))));
        json.append(",\"partitionFalseEmpty\":")
                .append(jsonStrings(pairs(partitioned.get(false), OracleP8::longLiteral)));
        json.append(",\"partitionTrue\":")
                .append(jsonStrings(pairs(partitioned.get(true), OracleP8::longLiteral)));
        json.append(",\"teeingToMapByRegion\":").append(jsonString(teeingToMapByRegion));
        json.append(",\"teeingToMapCount\":").append(jsonString(teeingToMapCount));
        json.append('}');
        System.out.println(json);
    }
}
