import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.DoubleSummaryStatistics;
import java.util.IntSummaryStatistics;
import java.util.List;
import java.util.LongSummaryStatistics;
import java.util.Optional;
import java.util.OptionalDouble;
import java.util.OptionalInt;
import java.util.OptionalLong;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;
import java.util.stream.DoubleStream;
import java.util.stream.IntStream;
import java.util.stream.LongStream;
import java.util.stream.Stream;

/**
 * P4-O01: JDK 25 Oracle Test（Phase 4指示 §13・§14）。
 * reduce全形式、count、min/max、find、match、sum/average/statistics、toArray、
 * forEach系、空Stream結果を、リポジトリに固定したJava 25コードで実行し、
 * Simulation Coreの結果と照合する。AI生成コードは実行しない。
 *
 * 厳密比較の対象外（観測記録）:
 * - findAnyが返した要素（JDKは特定要素を保証しない）
 * - peek + countでのpeek呼出し回数（評価省略は仕様上必須の動作ではない）
 * これらはJSONの前に「OBSERVATION:」行として出力し、証跡へ記録だけする。
 */
public class OracleP4 {

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

        // ---- reduce全形式と空結果（§6.1） ----
        Optional<String> reduceConcat =
                Stream.of("Java", "SQL", "Git").reduce((a, b) -> a + b);
        Optional<String> reduceConcatEmpty = Stream.<String>of().reduce((a, b) -> a + b);
        OptionalInt reduceIntNoIdentity = Arrays.stream(new int[]{3, 1, 4}).reduce((a, b) -> a + b);
        OptionalInt reduceIntEmpty = Arrays.stream(new int[]{}).reduce((a, b) -> a + b);
        int reduceIntIdentity = Arrays.stream(new int[]{3, 1, 4}).reduce(100, (a, b) -> a + b);
        int reduceIntIdentityEmpty = Arrays.stream(new int[]{}).reduce(100, (a, b) -> a + b);
        AtomicInteger combinerCalls = new AtomicInteger(0);
        long reduceSalary = employees.stream().reduce(
                0L,
                (acc, e) -> acc + e.salary(),
                (a, b) -> {
                    combinerCalls.incrementAndGet();
                    return Long.sum(a, b);
                });
        LongStream.of().count(); // touch LongStream import
        DoubleStream.of().count(); // touch DoubleStream import

        // ---- count（§6.2）と peek + count の観測 ----
        long count = employees.stream().count();
        long countEmpty = List.<Employee>of().stream().count();
        AtomicInteger peekCalls = new AtomicInteger(0);
        long peekCount = List.of("A", "B").stream().peek(s -> peekCalls.incrementAndGet()).count();

        // ---- min / max ----
        Optional<Employee> minAge = employees.stream().min(Comparator.comparingInt(Employee::age));
        Optional<Employee> maxAge = employees.stream().max(Comparator.comparingInt(Employee::age));
        Optional<Employee> minAgeEmpty =
                List.<Employee>of().stream().min(Comparator.comparingInt(Employee::age));
        OptionalInt minInt = Arrays.stream(new int[]{3, 1, 4}).min();
        OptionalLong maxLong = Arrays.stream(new long[]{30L, 10L, 20L}).max();
        OptionalDouble minDouble = Arrays.stream(new double[]{2.5, 1.5, 3.5}).min();
        OptionalInt minIntEmpty = Arrays.stream(new int[]{}).min();

        // ---- findFirst / findAny（§6.3） ----
        Optional<Employee> findFirst = employees.stream().filter(e -> e.age() >= 30).findFirst();
        Optional<Employee> findFirstEmpty =
                employees.stream().filter(e -> e.age() >= 100).findFirst();
        Optional<Employee> findAny = employees.stream().filter(e -> e.age() >= 30).findAny();

        // ---- match系とPredicate呼出し回数 ----
        AtomicInteger anyCalls = new AtomicInteger(0);
        boolean anyMatch = employees.stream().anyMatch(e -> {
            anyCalls.incrementAndGet();
            return e.age() >= 40;
        });
        AtomicInteger allCalls = new AtomicInteger(0);
        boolean allMatch = employees.stream().allMatch(e -> {
            allCalls.incrementAndGet();
            return e.age() >= 30;
        });
        AtomicInteger noneCalls = new AtomicInteger(0);
        boolean noneMatch = employees.stream().noneMatch(e -> {
            noneCalls.incrementAndGet();
            return e.age() >= 40;
        });
        AtomicInteger emptyCalls = new AtomicInteger(0);
        boolean anyMatchEmpty = List.<Employee>of().stream().anyMatch(e -> {
            emptyCalls.incrementAndGet();
            return true;
        });
        boolean allMatchEmpty = List.<Employee>of().stream().allMatch(e -> {
            emptyCalls.incrementAndGet();
            return false;
        });
        boolean noneMatchEmpty = List.<Employee>of().stream().noneMatch(e -> {
            emptyCalls.incrementAndGet();
            return true;
        });

        // ---- sum / average / summaryStatistics（§6.4） ----
        int sumInt = Arrays.stream(new int[]{3, 1, 4}).sum();
        long sumLong = Arrays.stream(new long[]{10L, 20L, 30L}).sum();
        double sumDouble = Arrays.stream(new double[]{1.5, 2.5}).sum();
        int sumIntEmpty = Arrays.stream(new int[]{}).sum();
        long sumLongEmpty = Arrays.stream(new long[]{}).sum();
        double sumDoubleEmpty = Arrays.stream(new double[]{}).sum();
        OptionalDouble avgInt = Arrays.stream(new int[]{3, 1, 4, 2}).average();
        OptionalDouble avgLong = Arrays.stream(new long[]{10L, 20L, 30L}).average();
        OptionalDouble avgDouble = Arrays.stream(new double[]{1.5, 2.5, 3.5}).average();
        OptionalDouble avgEmpty = Arrays.stream(new int[]{}).average();
        IntSummaryStatistics statsInt = Arrays.stream(new int[]{3, 1, 4, 2}).summaryStatistics();
        LongSummaryStatistics statsLong = Arrays.stream(new long[]{10L, 20L, 30L}).summaryStatistics();
        DoubleSummaryStatistics statsDouble =
                Arrays.stream(new double[]{1.5, 2.5, 3.5}).summaryStatistics();
        IntSummaryStatistics statsIntEmpty = Arrays.stream(new int[]{}).summaryStatistics();
        LongSummaryStatistics statsLongEmpty = Arrays.stream(new long[]{}).summaryStatistics();
        DoubleSummaryStatistics statsDoubleEmpty =
                Arrays.stream(new double[]{}).summaryStatistics();

        // ---- toArray（§6.5） ----
        Object[] objectArray = employees.stream().toArray();
        String[] stringArray = Stream.of("Java", "SQL").toArray(String[]::new);
        int[] intArray = Arrays.stream(new int[]{3, 1, 4}).toArray();
        String[] emptyStringArray = Stream.<String>of().toArray(String[]::new);

        // ---- forEach / forEachOrdered（§6.5） ----
        List<String> forEachActions = new ArrayList<>();
        employees.stream().forEach(e -> forEachActions.add(e.name()));
        List<Integer> forEachOrderedActions = new ArrayList<>();
        IntStream.of(3, 1, 4).forEachOrdered(forEachOrderedActions::add);
        AtomicInteger forEachEmptyCalls = new AtomicInteger(0);
        List.<Employee>of().stream().forEach(e -> forEachEmptyCalls.incrementAndGet());

        // ---- Stream.toList()のunmodifiable性 ----
        List<String> toListResult = Stream.of("Java").toList();
        boolean toListUnmodifiable;
        try {
            toListResult.add("SQL");
            toListUnmodifiable = false;
        } catch (UnsupportedOperationException e) {
            toListUnmodifiable = true;
        }

        // ---- 観測記録（厳密比較の対象外。保証ではない） ----
        System.out.println("OBSERVATION: findAnyObservedElement="
                + findAny.map(Employee::name).orElse("empty")
                + "（JDKは特定要素を保証しない。教材fixtureの選択は移植可能な保証ではない）");
        System.out.println("OBSERVATION: peekCallsDuringCount=" + peekCalls.get()
                + "（count結果=" + peekCount + "。評価省略は仕様上可能だが必須の動作ではなく、今回のJDKでの観測結果である）");

        System.out.println("{"
                + "\"reduceConcat\":\"" + reduceConcat.orElse("EMPTY") + "\","
                + "\"reduceConcatEmptyPresent\":" + reduceConcatEmpty.isPresent() + ","
                + "\"reduceIntNoIdentity\":" + reduceIntNoIdentity.getAsInt() + ","
                + "\"reduceIntEmptyPresent\":" + reduceIntEmpty.isPresent() + ","
                + "\"reduceIntIdentity\":" + reduceIntIdentity + ","
                + "\"reduceIntIdentityEmpty\":" + reduceIntIdentityEmpty + ","
                + "\"reduceSalary\":" + reduceSalary + ","
                + "\"reduceCombinerCalls\":" + combinerCalls.get() + ","
                + "\"count\":" + count + ","
                + "\"countEmpty\":" + countEmpty + ","
                + "\"peekCountResult\":" + peekCount + ","
                + "\"minAge\":\"" + minAge.map(Employee::name).orElse("EMPTY") + "\","
                + "\"maxAge\":\"" + maxAge.map(Employee::name).orElse("EMPTY") + "\","
                + "\"minAgeEmptyPresent\":" + minAgeEmpty.isPresent() + ","
                + "\"minInt\":" + minInt.getAsInt() + ","
                + "\"maxLong\":" + maxLong.getAsLong() + ","
                + "\"minDouble\":" + minDouble.getAsDouble() + ","
                + "\"minIntEmptyPresent\":" + minIntEmpty.isPresent() + ","
                + "\"findFirst\":\"" + findFirst.map(Employee::name).orElse("EMPTY") + "\","
                + "\"findFirstEmptyPresent\":" + findFirstEmpty.isPresent() + ","
                + "\"findAnyPresent\":" + findAny.isPresent() + ","
                + "\"anyMatch\":" + anyMatch + ","
                + "\"anyMatchCalls\":" + anyCalls.get() + ","
                + "\"allMatch\":" + allMatch + ","
                + "\"allMatchCalls\":" + allCalls.get() + ","
                + "\"noneMatch\":" + noneMatch + ","
                + "\"noneMatchCalls\":" + noneCalls.get() + ","
                + "\"anyMatchEmpty\":" + anyMatchEmpty + ","
                + "\"allMatchEmpty\":" + allMatchEmpty + ","
                + "\"noneMatchEmpty\":" + noneMatchEmpty + ","
                + "\"emptyMatchPredicateCalls\":" + emptyCalls.get() + ","
                + "\"sumInt\":" + sumInt + ","
                + "\"sumLong\":" + sumLong + ","
                + "\"sumDouble\":" + sumDouble + ","
                + "\"sumIntEmpty\":" + sumIntEmpty + ","
                + "\"sumLongEmpty\":" + sumLongEmpty + ","
                + "\"sumDoubleEmpty\":" + sumDoubleEmpty + ","
                + "\"avgInt\":" + avgInt.getAsDouble() + ","
                + "\"avgLong\":" + avgLong.getAsDouble() + ","
                + "\"avgDouble\":" + avgDouble.getAsDouble() + ","
                + "\"avgEmptyPresent\":" + avgEmpty.isPresent() + ","
                + "\"statsInt\":[" + statsInt.getCount() + "," + statsInt.getSum() + ","
                + statsInt.getMin() + "," + statsInt.getMax() + "," + statsInt.getAverage() + "],"
                + "\"statsLong\":[" + statsLong.getCount() + "," + statsLong.getSum() + ","
                + statsLong.getMin() + "," + statsLong.getMax() + "," + statsLong.getAverage() + "],"
                + "\"statsDouble\":[" + statsDouble.getCount() + "," + statsDouble.getSum() + ","
                + statsDouble.getMin() + "," + statsDouble.getMax() + "," + statsDouble.getAverage() + "],"
                + "\"statsIntEmpty\":[" + statsIntEmpty.getCount() + "," + statsIntEmpty.getSum() + ","
                + statsIntEmpty.getMin() + "," + statsIntEmpty.getMax() + "," + statsIntEmpty.getAverage() + "],"
                // 64bit境界値（Long.MAX_VALUE / Long.MIN_VALUE）はJavaScript numberの精度損失を
                // 避けるため10進文字列として出力する（レビュー対応・P4-O02）
                + "\"statsLongEmpty\":[" + statsLongEmpty.getCount() + "," + statsLongEmpty.getSum() + ","
                + "\"" + statsLongEmpty.getMin() + "\",\"" + statsLongEmpty.getMax() + "\"," + statsLongEmpty.getAverage() + "],"
                + "\"statsDoubleEmptyCount\":" + statsDoubleEmpty.getCount() + ","
                + "\"statsDoubleEmptyMinIsPositiveInfinity\":"
                + (statsDoubleEmpty.getMin() == Double.POSITIVE_INFINITY) + ","
                + "\"statsDoubleEmptyMaxIsNegativeInfinity\":"
                + (statsDoubleEmpty.getMax() == Double.NEGATIVE_INFINITY) + ","
                + "\"objectArrayLength\":" + objectArray.length + ","
                + "\"objectArrayComponent\":\"" + objectArray.getClass().getComponentType().getSimpleName() + "\","
                + "\"stringArray\":" + jsonStrings(Arrays.asList(stringArray)) + ","
                + "\"stringArrayComponent\":\"" + stringArray.getClass().getComponentType().getSimpleName() + "\","
                + "\"intArray\":" + jsonNumbers(Arrays.stream(intArray).boxed().toList()) + ","
                + "\"emptyStringArrayLength\":" + emptyStringArray.length + ","
                + "\"emptyStringArrayComponent\":\"" + emptyStringArray.getClass().getComponentType().getSimpleName() + "\","
                + "\"forEachActions\":" + jsonStrings(forEachActions) + ","
                + "\"forEachOrderedActions\":" + jsonNumbers(forEachOrderedActions) + ","
                + "\"forEachEmptyCalls\":" + forEachEmptyCalls.get() + ","
                + "\"toListUnmodifiable\":" + toListUnmodifiable
                + "}");
    }
}
