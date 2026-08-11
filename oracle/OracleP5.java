import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.TreeMap;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * P5-O01: Phase 5 Collectorの JDK 25 Oracle Test。
 *
 * 製品コードとは独立した固定Java 25コードで期待結果を実測し、
 * Simulation Core由来の期待値（expected-p5-from-core.json）と照合する。
 * AI生成コードは実行しない。標準Employeeデータ4件はDraft v0.8の基準fixtureと同一。
 *
 * unordered結果の比較正規化（Phase 5指示 §12.5）:
 *   groupingBy / toSet等が返すMap / Setのiteration orderはJDKの保証対象ではないため
 *   （Java SE 25 Collectors#groupingBy: "There are no guarantees on the type, mutability,
 *   serializability, or thread-safety of the Map or List objects returned."）、
 *   順序意味論を持たないSet / Mapは**キー・要素の表示文字列の辞書順**へ正規化してから照合する。
 *   この正規化は比較のためだけであり、JDKのiteration order保証を意味しない。
 *   TreeMap等、実際に順序性を持つ結果は正規化せず実順序のまま照合する（順序自体が検証対象）。
 *
 * 64bit境界値（Long.MAX_VALUE / Long.MIN_VALUE）とdoubleの±Infinityは、
 * JSON数値へ変換せず10進文字列のまま出力して1桁も損失させない。
 */
public class OracleP5 {

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

    record SalarySummary(long employeeCount, double averageSalary) {}

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
        return values.stream().map(OracleP5::jsonString).collect(Collectors.joining(",", "[", "]"));
    }

    /** 順序保証のないMapを「キーの辞書順に並べた [key, value] 配列」へ正規化する */
    private static <V> String normalizedMap(Map<?, V> map, java.util.function.Function<V, String> valueJson) {
        return map.entrySet().stream()
                .map(e -> new String[] {String.valueOf(e.getKey()), valueJson.apply(e.getValue())})
                .sorted(Comparator.comparing(pair -> pair[0]))
                .map(pair -> "[" + jsonString(pair[0]) + "," + pair[1] + "]")
                .collect(Collectors.joining(",", "[", "]"));
    }

    /** 順序性を持つMap（TreeMap等）は実順序のまま出力する（正規化しない） */
    private static <V> String orderedMap(Map<?, V> map, java.util.function.Function<V, String> valueJson) {
        return map.entrySet().stream()
                .map(e -> "[" + jsonString(String.valueOf(e.getKey())) + "," + valueJson.apply(e.getValue()) + "]")
                .collect(Collectors.joining(",", "[", "]"));
    }

    private static String namesJson(List<Employee> employees) {
        return jsonStrings(employees.stream().map(Employee::name).toList());
    }

    /** 順序保証のないSetは要素の辞書順へ正規化する */
    private static String normalizedSet(Set<String> set) {
        return jsonStrings(set.stream().sorted().toList());
    }

    public static void main(String[] args) {
        Department development = new Department("開発部", "技術本部");
        Department sales = new Department("営業部", "営業本部");
        List<Employee> employees = List.of(
                new Employee("佐藤", 35, 5_500_000L, 4.2, "関東",
                        LocalDate.of(2022, 4, 1), development, List.of("Java", "SQL")),
                new Employee("鈴木", 27, 4_200_000L, 3.8, "関西",
                        LocalDate.of(2023, 10, 1), sales, List.of("営業", "英語")),
                new Employee("高橋", 42, 7_200_000L, 4.6, "関東",
                        LocalDate.of(2018, 7, 15), development, List.of("Java", "設計")),
                new Employee("田中", 29, 4_800_000L, 4.0, "中部",
                        LocalDate.of(2021, 1, 5), sales, List.of("SQL", "分析")));
        List<Employee> empty = List.of();

        // ---- 単純Collector（§5.2） ----
        List<Employee> toList = employees.stream().collect(Collectors.toList());
        List<Employee> toListEmpty = empty.stream().collect(Collectors.toList());
        Set<String> toSet = employees.stream().map(Employee::region).collect(Collectors.toSet());
        Set<String> toSetEmpty = empty.stream().map(Employee::region).collect(Collectors.toSet());
        List<Employee> toCollection =
                employees.stream().collect(Collectors.toCollection(ArrayList::new));
        List<Employee> toCollectionEmpty =
                empty.stream().collect(Collectors.toCollection(ArrayList::new));

        String joining = employees.stream().map(Employee::name).collect(Collectors.joining());
        String joiningEmpty = empty.stream().map(Employee::name).collect(Collectors.joining());
        String joiningDelimiter =
                employees.stream().map(Employee::name).collect(Collectors.joining(", "));
        String joiningDelimiterEmpty =
                empty.stream().map(Employee::name).collect(Collectors.joining(", "));
        String joiningFull =
                employees.stream().map(Employee::name).collect(Collectors.joining(", ", "[", "]"));
        String joiningFullEmpty =
                empty.stream().map(Employee::name).collect(Collectors.joining(", ", "[", "]"));

        long counting = employees.stream().collect(Collectors.counting());
        long countingEmpty = empty.stream().collect(Collectors.counting());

        int summingInt = employees.stream().collect(Collectors.summingInt(Employee::age));
        int summingIntEmpty = empty.stream().collect(Collectors.summingInt(Employee::age));
        long summingLong = employees.stream().collect(Collectors.summingLong(Employee::salary));
        long summingLongEmpty = empty.stream().collect(Collectors.summingLong(Employee::salary));
        double summingDouble =
                employees.stream().collect(Collectors.summingDouble(Employee::evaluation));
        double summingDoubleEmpty =
                empty.stream().collect(Collectors.summingDouble(Employee::evaluation));

        double averagingInt = employees.stream().collect(Collectors.averagingInt(Employee::age));
        double averagingIntEmpty = empty.stream().collect(Collectors.averagingInt(Employee::age));
        double averagingLong =
                employees.stream().collect(Collectors.averagingLong(Employee::salary));
        double averagingLongEmpty =
                empty.stream().collect(Collectors.averagingLong(Employee::salary));
        double averagingDouble =
                employees.stream().collect(Collectors.averagingDouble(Employee::evaluation));
        double averagingDoubleEmpty =
                empty.stream().collect(Collectors.averagingDouble(Employee::evaluation));

        var statsInt = employees.stream().collect(Collectors.summarizingInt(Employee::age));
        var statsIntEmpty = empty.stream().collect(Collectors.summarizingInt(Employee::age));
        var statsLong = employees.stream().collect(Collectors.summarizingLong(Employee::salary));
        var statsLongEmpty = empty.stream().collect(Collectors.summarizingLong(Employee::salary));
        var statsDouble =
                employees.stream().collect(Collectors.summarizingDouble(Employee::evaluation));
        var statsDoubleEmpty =
                empty.stream().collect(Collectors.summarizingDouble(Employee::evaluation));

        Optional<Employee> minBy = employees.stream()
                .collect(Collectors.minBy(Comparator.comparingInt(Employee::age)));
        Optional<Employee> minByEmpty = empty.stream()
                .collect(Collectors.minBy(Comparator.comparingInt(Employee::age)));
        Optional<Employee> maxBy = employees.stream()
                .collect(Collectors.maxBy(Comparator.comparingLong(Employee::salary)));
        Optional<Employee> maxByEmpty = empty.stream()
                .collect(Collectors.maxBy(Comparator.comparingLong(Employee::salary)));
        Optional<String> reducing = employees.stream().map(Employee::name)
                .collect(Collectors.reducing((a, b) -> a + b));
        Optional<String> reducingEmpty = empty.stream().map(Employee::name)
                .collect(Collectors.reducing((a, b) -> a + b));

        // ---- downstream合成 ----
        Map<String, List<String>> mapping = employees.stream()
                .collect(Collectors.groupingBy(e -> e.department().name(),
                        Collectors.mapping(Employee::name, Collectors.toList())));
        Map<String, List<Employee>> filtering = employees.stream()
                .collect(Collectors.groupingBy(e -> e.department().name(),
                        Collectors.filtering(e -> e.salary() >= 5_000_000L, Collectors.toList())));
        Map<String, List<String>> flatMapping = employees.stream()
                .collect(Collectors.groupingBy(e -> e.department().name(),
                        Collectors.flatMapping(e -> e.skills().stream(), Collectors.toList())));
        List<Employee> collectingAndThen = employees.stream()
                .collect(Collectors.collectingAndThen(Collectors.toList(), List::copyOf));
        List<Employee> collectingAndThenEmpty = empty.stream()
                .collect(Collectors.collectingAndThen(Collectors.toList(), List::copyOf));

        // ---- 分類ツリー ----
        Map<Department, List<Employee>> groupingByDepartment =
                employees.stream().collect(Collectors.groupingBy(Employee::department));
        Map<Department, List<Employee>> groupingByDepartmentEmpty =
                empty.stream().collect(Collectors.groupingBy(Employee::department));
        Map<String, Long> groupingByCounting = employees.stream()
                .collect(Collectors.groupingBy(Employee::region, Collectors.counting()));
        Map<String, Double> groupingByAveraging = employees.stream()
                .collect(Collectors.groupingBy(Employee::region,
                        Collectors.averagingLong(Employee::salary)));
        // TreeMap: キーの順序性を持つため正規化せず実順序で照合する
        TreeMap<String, List<Employee>> groupingByTreeMap = employees.stream()
                .collect(Collectors.groupingBy(Employee::region, TreeMap::new, Collectors.toList()));
        Map<Department, Map<String, List<Employee>>> nestedGroupingBy = employees.stream()
                .collect(Collectors.groupingBy(Employee::department,
                        Collectors.groupingBy(Employee::region)));
        Map<Boolean, List<Employee>> partitioningBy =
                employees.stream().collect(Collectors.partitioningBy(e -> e.age() >= 30));
        Map<Boolean, List<Employee>> partitioningByEmpty =
                empty.stream().collect(Collectors.partitioningBy(e -> e.age() >= 30));
        Map<Boolean, Long> partitioningByCounting = employees.stream()
                .collect(Collectors.partitioningBy(e -> e.age() >= 30, Collectors.counting()));
        Map<Boolean, Long> partitioningByCountingEmpty = empty.stream()
                .collect(Collectors.partitioningBy(e -> e.age() >= 30, Collectors.counting()));

        // ---- teeing（docs/phase-5-decisions.md §9の基準fixture） ----
        SalarySummary teeing = employees.stream().collect(Collectors.teeing(
                Collectors.counting(),
                Collectors.averagingLong(Employee::salary),
                SalarySummary::new));
        SalarySummary teeingEmpty = empty.stream().collect(Collectors.teeing(
                Collectors.counting(),
                Collectors.averagingLong(Employee::salary),
                SalarySummary::new));

        // ---- 3引数collect（§5.1） ----
        List<Employee> collectTriple =
                employees.stream().collect(ArrayList::new, ArrayList::add, ArrayList::addAll);
        List<Employee> collectTripleEmpty =
                empty.stream().collect(ArrayList::new, ArrayList::add, ArrayList::addAll);

        // ---- 持越し: takeWhile / dropWhileのEmployee fieldCompare（§5.3） ----
        List<Employee> takeWhile = employees.stream()
                .takeWhile(e -> e.salary() >= 5_000_000L).toList();
        List<Employee> dropWhile = employees.stream()
                .dropWhile(e -> e.salary() >= 5_000_000L).toList();

        // ---- 補償付き加算が実際に効くdouble列（Simulation Coreのアルゴリズム照合用） ----
        // 教材fixture（evaluation 4.2/3.8/4.6/4.0）では補償が残らず、符号の誤りを検出できないため、
        // 補償が結果に現れる列を明示的に照合する。
        List<List<Double>> compensationCases = List.of(
                List.of(0.001, 0.01),
                List.of(1.0e16, 1.0, 1.0, 1.0, -1.0e16),
                List.of(0.1, 0.2, 0.3));
        List<String> compensatedSums = compensationCases.stream()
                .map(values -> String.valueOf(
                        values.stream().collect(Collectors.summingDouble(Double::doubleValue))))
                .toList();
        List<String> naiveSums = compensationCases.stream()
                .map(values -> {
                    double total = 0.0;
                    for (double v : values) total += v;
                    return String.valueOf(total);
                })
                .toList();
        List<String> compensatedAverages = compensationCases.stream()
                .map(values -> String.valueOf(
                        values.stream().collect(Collectors.averagingDouble(Double::doubleValue))))
                .toList();
        List<String> compensatedStatsSums = compensationCases.stream()
                .map(values -> String.valueOf(
                        values.stream().collect(Collectors.summarizingDouble(Double::doubleValue)).getSum()))
                .toList();

        // ---- Collectors.toList()の可変性（Stream.toList()との差） ----
        boolean collectorsToListMutable;
        try {
            List<Employee> mutable = employees.stream().collect(Collectors.toList());
            mutable.add(employees.get(0));
            collectorsToListMutable = true;
        } catch (UnsupportedOperationException e) {
            collectorsToListMutable = false;
        }

        // ---- 観測記録（厳密比較の対象外。JDKの保証として扱わない） ----
        System.out.println("OBSERVATION: groupingByMapClass=" + groupingByCounting.getClass().getSimpleName()
                + "（groupingByの返却Map型はJDKの保証対象ではない）");
        System.out.println("OBSERVATION: toSetClass=" + toSet.getClass().getSimpleName()
                + "（toSetの返却Set型・iteration orderはJDKの保証対象ではない）");
        System.out.println("OBSERVATION: collectorsToListMutable=" + collectorsToListMutable
                + "（Collectors.toList()の可変性は保証されない。Stream.toList()はunmodifiable）");

        // ---- 最終行に1行JSONを出力する ----
        StringBuilder json = new StringBuilder("{");
        json.append("\"toList\":").append(namesJson(toList));
        json.append(",\"toListEmpty\":").append(namesJson(toListEmpty));
        json.append(",\"toSet\":").append(normalizedSet(toSet));
        json.append(",\"toSetEmpty\":").append(normalizedSet(toSetEmpty));
        json.append(",\"toCollection\":").append(namesJson(toCollection));
        json.append(",\"toCollectionEmpty\":").append(namesJson(toCollectionEmpty));
        json.append(",\"joining\":").append(jsonString(joining));
        json.append(",\"joiningEmpty\":").append(jsonString(joiningEmpty));
        json.append(",\"joiningDelimiter\":").append(jsonString(joiningDelimiter));
        json.append(",\"joiningDelimiterEmpty\":").append(jsonString(joiningDelimiterEmpty));
        json.append(",\"joiningFull\":").append(jsonString(joiningFull));
        json.append(",\"joiningFullEmpty\":").append(jsonString(joiningFullEmpty));
        json.append(",\"counting\":").append(counting);
        json.append(",\"countingEmpty\":").append(countingEmpty);
        json.append(",\"summingInt\":").append(summingInt);
        json.append(",\"summingIntEmpty\":").append(summingIntEmpty);
        json.append(",\"summingLong\":").append(summingLong);
        json.append(",\"summingLongEmpty\":").append(summingLongEmpty);
        json.append(",\"summingDouble\":").append(jsonString(String.valueOf(summingDouble)));
        json.append(",\"summingDoubleEmpty\":").append(jsonString(String.valueOf(summingDoubleEmpty)));
        json.append(",\"averagingInt\":").append(jsonString(String.valueOf(averagingInt)));
        json.append(",\"averagingIntEmpty\":").append(jsonString(String.valueOf(averagingIntEmpty)));
        json.append(",\"averagingLong\":").append(jsonString(String.valueOf(averagingLong)));
        json.append(",\"averagingLongEmpty\":").append(jsonString(String.valueOf(averagingLongEmpty)));
        json.append(",\"averagingDouble\":").append(jsonString(String.valueOf(averagingDouble)));
        json.append(",\"averagingDoubleEmpty\":").append(jsonString(String.valueOf(averagingDoubleEmpty)));
        // 統計は [count, sum, min, max, average] の順。64bit境界値と±Infinityは10進文字列で出力する
        json.append(",\"statsInt\":[").append(statsInt.getCount()).append(',')
                .append(statsInt.getSum()).append(',')
                .append(statsInt.getMin()).append(',')
                .append(statsInt.getMax()).append(',')
                .append(jsonString(String.valueOf(statsInt.getAverage()))).append(']');
        json.append(",\"statsIntEmpty\":[").append(statsIntEmpty.getCount()).append(',')
                .append(statsIntEmpty.getSum()).append(',')
                .append(statsIntEmpty.getMin()).append(',')
                .append(statsIntEmpty.getMax()).append(',')
                .append(jsonString(String.valueOf(statsIntEmpty.getAverage()))).append(']');
        json.append(",\"statsLong\":[").append(statsLong.getCount()).append(',')
                .append(statsLong.getSum()).append(',')
                .append(statsLong.getMin()).append(',')
                .append(statsLong.getMax()).append(',')
                .append(jsonString(String.valueOf(statsLong.getAverage()))).append(']');
        json.append(",\"statsLongEmpty\":[").append(statsLongEmpty.getCount()).append(',')
                .append(statsLongEmpty.getSum()).append(',')
                .append(jsonString(String.valueOf(statsLongEmpty.getMin()))).append(',')
                .append(jsonString(String.valueOf(statsLongEmpty.getMax()))).append(',')
                .append(jsonString(String.valueOf(statsLongEmpty.getAverage()))).append(']');
        json.append(",\"statsDouble\":[").append(statsDouble.getCount()).append(',')
                .append(jsonString(String.valueOf(statsDouble.getSum()))).append(',')
                .append(jsonString(String.valueOf(statsDouble.getMin()))).append(',')
                .append(jsonString(String.valueOf(statsDouble.getMax()))).append(',')
                .append(jsonString(String.valueOf(statsDouble.getAverage()))).append(']');
        json.append(",\"statsDoubleEmpty\":[").append(statsDoubleEmpty.getCount()).append(',')
                .append(jsonString(String.valueOf(statsDoubleEmpty.getSum()))).append(',')
                .append(jsonString(String.valueOf(statsDoubleEmpty.getMin()))).append(',')
                .append(jsonString(String.valueOf(statsDoubleEmpty.getMax()))).append(',')
                .append(jsonString(String.valueOf(statsDoubleEmpty.getAverage()))).append(']');
        json.append(",\"minByName\":").append(jsonString(minBy.map(Employee::name).orElse("")));
        json.append(",\"minByEmptyPresent\":").append(minByEmpty.isPresent());
        json.append(",\"maxByName\":").append(jsonString(maxBy.map(Employee::name).orElse("")));
        json.append(",\"maxByEmptyPresent\":").append(maxByEmpty.isPresent());
        json.append(",\"reducing\":").append(jsonString(reducing.orElse("")));
        json.append(",\"reducingEmptyPresent\":").append(reducingEmpty.isPresent());
        json.append(",\"mapping\":").append(normalizedMap(mapping, OracleP5::jsonStrings));
        json.append(",\"filtering\":").append(normalizedMap(filtering, OracleP5::namesJson));
        json.append(",\"flatMapping\":").append(normalizedMap(flatMapping, OracleP5::jsonStrings));
        json.append(",\"collectingAndThen\":").append(namesJson(collectingAndThen));
        json.append(",\"collectingAndThenEmpty\":").append(namesJson(collectingAndThenEmpty));
        json.append(",\"groupingByDepartment\":")
                .append(normalizedMap(groupingByDepartment, OracleP5::namesJson));
        json.append(",\"groupingByDepartmentEmpty\":")
                .append(normalizedMap(groupingByDepartmentEmpty, OracleP5::namesJson));
        json.append(",\"groupingByCounting\":")
                .append(normalizedMap(groupingByCounting, String::valueOf));
        json.append(",\"groupingByAveraging\":")
                .append(normalizedMap(groupingByAveraging, v -> jsonString(String.valueOf(v))));
        // TreeMapは実順序のまま照合する（順序自体が検証対象）
        json.append(",\"groupingByTreeMapOrdered\":")
                .append(orderedMap(groupingByTreeMap, OracleP5::namesJson));
        json.append(",\"nestedGroupingBy\":").append(normalizedMap(nestedGroupingBy,
                inner -> normalizedMap(inner, OracleP5::namesJson)));
        json.append(",\"partitioningBy\":")
                .append(normalizedMap(partitioningBy, OracleP5::namesJson));
        json.append(",\"partitioningByEmpty\":")
                .append(normalizedMap(partitioningByEmpty, OracleP5::namesJson));
        json.append(",\"partitioningByCounting\":")
                .append(normalizedMap(partitioningByCounting, String::valueOf));
        json.append(",\"partitioningByCountingEmpty\":")
                .append(normalizedMap(partitioningByCountingEmpty, String::valueOf));
        json.append(",\"teeingCount\":").append(teeing.employeeCount());
        json.append(",\"teeingAverage\":").append(jsonString(String.valueOf(teeing.averageSalary())));
        json.append(",\"teeingEmptyCount\":").append(teeingEmpty.employeeCount());
        json.append(",\"teeingEmptyAverage\":")
                .append(jsonString(String.valueOf(teeingEmpty.averageSalary())));
        json.append(",\"teeingRecordToString\":").append(jsonString(teeing.toString()));
        json.append(",\"teeingEmptyRecordToString\":").append(jsonString(teeingEmpty.toString()));
        json.append(",\"collectTriple\":").append(namesJson(collectTriple));
        json.append(",\"collectTripleEmpty\":").append(namesJson(collectTripleEmpty));
        json.append(",\"takeWhileSalary\":").append(namesJson(takeWhile));
        json.append(",\"dropWhileSalary\":").append(namesJson(dropWhile));
        // 補償付き加算: 単純合計と異なることも同時に照合し、補償が効いていることを固定する
        json.append(",\"compensatedSums\":").append(jsonStrings(compensatedSums));
        json.append(",\"naiveSums\":").append(jsonStrings(naiveSums));
        json.append(",\"compensatedAverages\":").append(jsonStrings(compensatedAverages));
        json.append(",\"compensatedStatsSums\":").append(jsonStrings(compensatedStatsSums));
        json.append('}');
        System.out.println(json);

        // 未使用警告の回避（Stream.emptyの型付き利用を明示）
        assert Stream.<String>empty().collect(Collectors.joining(",", "[", "]")).equals("[]");
    }
}
