import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;

/**
 * P2-O01: JDK 25 Oracle Test（Phase 2指示 §12.5）。
 * finite source、map、mapToInt/Long/Double、boxed、mapToObj、flatMap/flatMapToX、
 * object/primitive emptyの代表結果と型を、Simulation Coreの結果と照合する。
 * fixtureはPhase 2のfixture providerと同じ値・順序を使用する。
 */
public class OracleP2 {

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

        // ---- finite source ----
        List<String> collectionNames = employees.stream().map(Employee::name).toList();

        String[] names = { "java", "sql", "web" };
        List<String> arraysUpper = Arrays.stream(names).map(String::toUpperCase).toList();

        int[] numbers = { 3, 1, 4 };
        List<Integer> arraysInt = Arrays.stream(numbers).boxed().toList();

        List<String> streamOfUpper = Stream.of("Java", "SQL").map(String::toUpperCase).toList();

        List<Integer> iterate3 = Stream.iterate(1, n -> n <= 5, n -> n + 1).toList();

        List<Integer> range = IntStream.range(1, 5).boxed().toList();
        List<Integer> rangeClosed = IntStream.rangeClosed(1, 5).boxed().toList();

        // ---- map / mapToX / boxed / mapToObj ----
        List<Integer> ages = employees.stream().mapToInt(Employee::age).boxed().toList();
        List<Long> salaries = employees.stream().mapToLong(Employee::salary).boxed().toList();
        List<Double> evaluations = employees.stream().mapToDouble(Employee::evaluation).boxed().toList();
        List<Integer> boxedRange = IntStream.range(1, 4).boxed().toList();
        List<String> mapToObj = IntStream.range(1, 4).mapToObj(n -> "No." + n).toList();

        // ---- flatMap / flatMapToX ----
        List<List<String>> nested = List.of(
                List.of("Java", "SQL"),
                List.of(),
                List.of("分析"));
        List<String> flatten = nested.stream().flatMap(List::stream).toList();

        List<Integer> flattenInt = Stream.of(new int[]{1, 2}, new int[]{3})
                .flatMapToInt(Arrays::stream).boxed().toList();
        List<Long> flattenLong = Stream.of(new long[]{10L, 20L}, new long[]{30L})
                .flatMapToLong(Arrays::stream).boxed().toList();
        List<Double> flattenDouble = Stream.of(new double[]{1.5, 2.5}, new double[]{3.5})
                .flatMapToDouble(Arrays::stream).boxed().toList();

        // ---- empty ----
        List<String> emptyObject = Stream.<String>empty().toList();
        List<Integer> emptyInt = IntStream.empty().boxed().toList();
        List<Long> emptyLong = java.util.stream.LongStream.empty().boxed().toList();
        List<Double> emptyDouble = java.util.stream.DoubleStream.empty().boxed().toList();

        // ---- 型（wrapper要素型）の照合 ----
        String agesElementType = ages.get(0).getClass().getSimpleName();
        String salariesElementType = salaries.get(0).getClass().getSimpleName();
        String evaluationsElementType = evaluations.get(0).getClass().getSimpleName();
        String mapToObjElementType = mapToObj.get(0).getClass().getSimpleName();
        String flattenIntElementType = flattenInt.get(0).getClass().getSimpleName();

        System.out.println("{"
                + "\"collectionNames\":" + jsonStrings(collectionNames) + ","
                + "\"arraysUpper\":" + jsonStrings(arraysUpper) + ","
                + "\"arraysInt\":" + jsonNumbers(arraysInt) + ","
                + "\"streamOfUpper\":" + jsonStrings(streamOfUpper) + ","
                + "\"iterate3\":" + jsonNumbers(iterate3) + ","
                + "\"range\":" + jsonNumbers(range) + ","
                + "\"rangeClosed\":" + jsonNumbers(rangeClosed) + ","
                + "\"ages\":" + jsonNumbers(ages) + ","
                + "\"salaries\":" + jsonNumbers(salaries) + ","
                + "\"evaluations\":" + jsonNumbers(evaluations) + ","
                + "\"boxedRange\":" + jsonNumbers(boxedRange) + ","
                + "\"mapToObj\":" + jsonStrings(mapToObj) + ","
                + "\"flatten\":" + jsonStrings(flatten) + ","
                + "\"flattenInt\":" + jsonNumbers(flattenInt) + ","
                + "\"flattenLong\":" + jsonNumbers(flattenLong) + ","
                + "\"flattenDouble\":" + jsonNumbers(flattenDouble) + ","
                + "\"emptyObject\":" + jsonStrings(emptyObject) + ","
                + "\"emptyInt\":" + jsonNumbers(emptyInt) + ","
                + "\"emptyLong\":" + jsonNumbers(emptyLong) + ","
                + "\"emptyDouble\":" + jsonNumbers(emptyDouble) + ","
                + "\"agesElementType\":\"" + agesElementType + "\","
                + "\"salariesElementType\":\"" + salariesElementType + "\","
                + "\"evaluationsElementType\":\"" + evaluationsElementType + "\","
                + "\"mapToObjElementType\":\"" + mapToObjElementType + "\","
                + "\"flattenIntElementType\":\"" + flattenIntElementType + "\""
                + "}");
    }
}
