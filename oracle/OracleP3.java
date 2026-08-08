import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Objects;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;

/**
 * P3-O01: JDK 25 Oracle Test（Phase 3指示 §13.5）。
 * distinct / sorted（natural・Comparator）/ limit / skip / takeWhile / dropWhile / peek、
 * generate / iterate2 + limit、空入力、peek呼出し列を、リポジトリに固定した
 * Java 25コードで実行し、Simulation Coreの結果と照合する。
 * fixtureはPhase 3のfixture providerと同じ値・順序を使用する。AI生成コードは実行しない。
 */
public class OracleP3 {

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

    /** distinctのordered先頭保持検証用。equalsをkeyだけで判定し、どのインスタンスが残るかを追跡する */
    static final class Tag {
        final String key;
        final int index;

        Tag(String key, int index) {
            this.key = key;
            this.index = index;
        }

        @Override
        public boolean equals(Object o) {
            return o instanceof Tag t && t.key.equals(key);
        }

        @Override
        public int hashCode() {
            return Objects.hash(key);
        }
    }

    private static String jsonStrings(List<String> values) {
        return values.stream().map(s -> "\"" + s + "\"").collect(Collectors.joining(",", "[", "]"));
    }

    private static String jsonNumbers(List<? extends Number> values) {
        return values.stream().map(String::valueOf).collect(Collectors.joining(",", "[", "]"));
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

        // ---- distinct（結果とordered先頭保持） ----
        List<String> distinct = Stream.of("Java", "SQL", "Java", "Git", "SQL").distinct().toList();
        List<Integer> distinctKeptIndices = Stream.of(
                        new Tag("Java", 0), new Tag("SQL", 1), new Tag("Java", 2),
                        new Tag("Git", 3), new Tag("SQL", 4))
                .distinct()
                .map(t -> t.index)
                .toList();

        // ---- sorted（String natural / Employee region Comparator + 同値キーstable順） ----
        List<String> sortedNatural = Stream.of("SQL", "Java", "Git", "API").sorted().toList();
        List<String> sortedComparatorNames = employees.stream()
                .sorted(Comparator.comparing(Employee::region))
                .map(Employee::name)
                .toList();

        // ---- limit / skip（0・一部・全件境界） ----
        List<Integer> limitStandard = IntStream.rangeClosed(1, 5).limit(3).boxed().toList();
        List<Integer> limitZero = IntStream.rangeClosed(1, 5).limit(0).boxed().toList();
        List<Integer> limitEqual = IntStream.rangeClosed(1, 3).limit(3).boxed().toList();
        List<Integer> limitOver = IntStream.rangeClosed(1, 2).limit(5).boxed().toList();
        List<Integer> skipStandard = Arrays.stream(new int[]{10, 20, 30, 40}).skip(2).boxed().toList();
        List<Integer> skipZero = Arrays.stream(new int[]{10, 20, 30, 40}).skip(0).boxed().toList();
        List<Integer> skipAll = Arrays.stream(new int[]{10, 20, 30, 40}).skip(6).boxed().toList();

        // ---- takeWhile / dropWhile（基準入力） ----
        List<Integer> takeWhileStandard =
                Arrays.stream(new int[]{1, 2, 6, 3, 7}).takeWhile(n -> n < 5).boxed().toList();
        List<Integer> takeWhileFirstFalse =
                Arrays.stream(new int[]{6, 3, 7}).takeWhile(n -> n < 5).boxed().toList();
        List<Integer> dropWhileStandard =
                Arrays.stream(new int[]{1, 2, 6, 3, 7}).dropWhile(n -> n < 5).boxed().toList();
        List<Integer> dropWhileAllTrue =
                Arrays.stream(new int[]{1, 2, 3}).dropWhile(n -> n < 5).boxed().toList();

        // ---- generate / iterate2 + limit（supplier呼び出し回数を含む） ----
        AtomicInteger counter = new AtomicInteger(0);
        List<Integer> generateLimit = Stream.generate(counter::incrementAndGet).limit(3).toList();
        int generateSupplierCalls = counter.get();
        List<Integer> iterateLimit = Stream.iterate(1, n -> n + 1).limit(5).toList();

        // ---- peek（action呼出し順と最終結果の不変性） ----
        List<String> peekActions = new ArrayList<>();
        List<Employee> peekResult = employees.stream().peek(e -> peekActions.add(e.name())).toList();
        List<String> peekResultNames = peekResult.stream().map(Employee::name).toList();

        // ---- primitive Streamのsorted / distinct（Double.compare準拠） ----
        List<Integer> intSorted = Arrays.stream(new int[]{3, 1, 2}).sorted().boxed().toList();
        List<Long> longSorted = Arrays.stream(new long[]{30L, 10L, 20L}).sorted().boxed().toList();
        List<Double> doubleSorted = Arrays.stream(new double[]{2.5, 1.5, 3.5}).sorted().boxed().toList();
        List<Double> doubleDistinct = Arrays.stream(new double[]{2.5, 1.5, 2.5}).distinct().boxed().toList();

        // ---- 空Streamで各操作が空結果となること ----
        List<String> emptyDistinct = Stream.<String>of().distinct().toList();
        List<String> emptySorted = Stream.<String>of().sorted().toList();
        List<Integer> emptyLimit = IntStream.rangeClosed(1, 0).limit(3).boxed().toList();
        List<Integer> emptySkip = Arrays.stream(new int[]{}).skip(2).boxed().toList();
        List<Integer> emptyTakeWhile = Arrays.stream(new int[]{}).takeWhile(n -> n < 5).boxed().toList();
        List<Integer> emptyDropWhile = Arrays.stream(new int[]{}).dropWhile(n -> n < 5).boxed().toList();
        List<String> emptyPeekActions = new ArrayList<>();
        List<Employee> emptyPeek = List.<Employee>of().stream()
                .peek(e -> emptyPeekActions.add(e.name()))
                .toList();
        List<String> emptyPeekNames = emptyPeek.stream().map(Employee::name).toList();

        System.out.println("{"
                + "\"distinct\":" + jsonStrings(distinct) + ","
                + "\"distinctKeptIndices\":" + jsonNumbers(distinctKeptIndices) + ","
                + "\"sortedNatural\":" + jsonStrings(sortedNatural) + ","
                + "\"sortedComparatorNames\":" + jsonStrings(sortedComparatorNames) + ","
                + "\"limitStandard\":" + jsonNumbers(limitStandard) + ","
                + "\"limitZero\":" + jsonNumbers(limitZero) + ","
                + "\"limitEqual\":" + jsonNumbers(limitEqual) + ","
                + "\"limitOver\":" + jsonNumbers(limitOver) + ","
                + "\"skipStandard\":" + jsonNumbers(skipStandard) + ","
                + "\"skipZero\":" + jsonNumbers(skipZero) + ","
                + "\"skipAll\":" + jsonNumbers(skipAll) + ","
                + "\"takeWhileStandard\":" + jsonNumbers(takeWhileStandard) + ","
                + "\"takeWhileFirstFalse\":" + jsonNumbers(takeWhileFirstFalse) + ","
                + "\"dropWhileStandard\":" + jsonNumbers(dropWhileStandard) + ","
                + "\"dropWhileAllTrue\":" + jsonNumbers(dropWhileAllTrue) + ","
                + "\"generateLimit\":" + jsonNumbers(generateLimit) + ","
                + "\"generateSupplierCalls\":" + generateSupplierCalls + ","
                + "\"iterateLimit\":" + jsonNumbers(iterateLimit) + ","
                + "\"peekResultNames\":" + jsonStrings(peekResultNames) + ","
                + "\"peekActions\":" + jsonStrings(peekActions) + ","
                + "\"intSorted\":" + jsonNumbers(intSorted) + ","
                + "\"longSorted\":" + jsonNumbers(longSorted) + ","
                + "\"doubleSorted\":" + jsonNumbers(doubleSorted) + ","
                + "\"doubleDistinct\":" + jsonNumbers(doubleDistinct) + ","
                + "\"emptyDistinct\":" + jsonStrings(emptyDistinct) + ","
                + "\"emptySorted\":" + jsonStrings(emptySorted) + ","
                + "\"emptyLimit\":" + jsonNumbers(emptyLimit) + ","
                + "\"emptySkip\":" + jsonNumbers(emptySkip) + ","
                + "\"emptyTakeWhile\":" + jsonNumbers(emptyTakeWhile) + ","
                + "\"emptyDropWhile\":" + jsonNumbers(emptyDropWhile) + ","
                + "\"emptyPeek\":" + jsonStrings(emptyPeekNames) + ","
                + "\"emptyPeekActionCount\":" + emptyPeekActions.size()
                + "}");
    }
}
