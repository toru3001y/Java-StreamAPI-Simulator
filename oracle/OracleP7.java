import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Gatherer;
import java.util.stream.Gatherers;
import java.util.stream.Stream;

/**
 * P7-O01: Phase 7 Gatherer実行の JDK 25 Oracle Test。
 *
 * 製品コードとは独立した固定Java 25コードで期待結果を実測し、
 * Simulation Core由来の期待値（expected-p7-from-core.json）と照合する。
 *
 * 対象は Phase 7指示 §8.2 の11ケース（standard 7 + emptySource 4）:
 *   1. windowFixed(3) → toList（Employee 4件。残余あり）
 *   2. windowFixed(2) → toList（Employee 4件。窓サイズの倍数）
 *   3. windowFixed(3) → toList（空）
 *   4. windowSliding(2) → toList（String 4件）
 *   5. windowSliding(3) → toList（String 2件。入力 < 窓サイズ）
 *   6. windowSliding(2) → toList（空）
 *   7. scan(() -> 0, (acc, n) -> acc + n) → toList（int[]{3,1,4} を boxed）
 *   8. scan（空）
 *   9. scan(() -> "", (acc, s) -> acc + s) → toList（String 3件）
 *  10. fold(() -> 0L, (acc, e) -> acc + e.salary()) → findFirst（Employee 4件）
 *  11. fold（空。identityの単一要素）
 *
 * v0.9 §7の空入力表4行（windowFixed空 / windowSliding空 / scan空 / fold空）を
 * すべて含む。「導出」区分（scan空・fold空）は導出と実測が食い違った場合に
 * 照合がFAILとなり停止する。
 *
 * 数値の表記合わせ（Phase 5〜6で確立したCore表記との整合方式を踏襲する）:
 *   - long は {@link #longLiteral(long)} で3桁区切り + L の表記へ揃える
 *     （Simulation Core の formatLongLiteral と同一規則）。
 *   - Employee要素は Core の formatSimValue と同じ `氏名（age=NN）` 表記へ揃える。
 *   - String要素は Core と同じクォート付き表記へ揃える。
 *   - 窓（List）は Core の formatSimValue の再帰整形と同じ `[要素1, 要素2]` 表記へ揃える。
 *
 * あわせて OBSERVATION として、組み込み4種それぞれの
 *   integrator() instanceof Gatherer.Integrator.Greedy /
 *   combiner() == Gatherer.defaultCombiner() /
 *   finisher() == Gatherer.defaultFinisher()
 * の計12行を出力する（v0.9 §10-3。厳密比較の対象外の観測記録）。
 */
public class OracleP7 {

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
        return values.stream().map(OracleP7::jsonString).collect(Collectors.joining(",", "[", "]"));
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

    /** Coreの`formatSimValue`（list variant）と同じ再帰整形 */
    private static <T> String listLabel(List<T> window, java.util.function.Function<T, String> f) {
        return window.stream().map(f).collect(Collectors.joining(", ", "[", "]"));
    }

    /**
     * 組み込みGathererの構成要素をOBSERVATIONとして観測する（厳密比較の対象外）。
     * 型引数A / Rを明示して捕捉変換を揃えないと、default実装との`==`比較がコンパイルできない。
     */
    private static <T, A, R> void observe(String name, Gatherer<T, A, R> gatherer) {
        System.out.println("OBSERVATION: " + name
                + ".integratorIsGreedy=" + (gatherer.integrator() instanceof Gatherer.Integrator.Greedy));
        System.out.println("OBSERVATION: " + name
                + ".combinerIsDefault=" + (gatherer.combiner() == Gatherer.<A>defaultCombiner()));
        System.out.println("OBSERVATION: " + name
                + ".finisherIsDefault=" + (gatherer.finisher() == Gatherer.<A, R>defaultFinisher()));
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
        List<Employee> noEmployees = List.of();

        // ---- 1. windowFixed(3)（残余あり） ----
        List<String> windowFixed3 = employees.stream()
                .gather(Gatherers.windowFixed(3))
                .map(w -> listLabel(w, OracleP7::employeeLabel))
                .toList();

        // ---- 2. windowFixed(2)（窓サイズの倍数） ----
        List<String> windowFixed2 = employees.stream()
                .gather(Gatherers.windowFixed(2))
                .map(w -> listLabel(w, OracleP7::employeeLabel))
                .toList();

        // ---- 3. windowFixed(3)（空。v0.9 §7: 窓0件 → []） ----
        List<String> windowFixedEmpty = noEmployees.stream()
                .gather(Gatherers.windowFixed(3))
                .map(w -> listLabel(w, OracleP7::employeeLabel))
                .toList();

        // ---- 4. windowSliding(2)（String 4件） ----
        List<String> slidingWords = List.of("Java", "SQL", "Git", "AWS");
        List<String> windowSliding2 = slidingWords.stream()
                .gather(Gatherers.windowSliding(2))
                .map(w -> listLabel(w, OracleP7::stringLabel))
                .toList();

        // ---- 5. windowSliding(3)（入力2件 < 窓サイズ3。全要素の1窓） ----
        List<String> windowSlidingShort = List.of("Java", "SQL").stream()
                .gather(Gatherers.windowSliding(3))
                .map(w -> listLabel(w, OracleP7::stringLabel))
                .toList();

        // ---- 6. windowSliding(2)（空。v0.9 §7: 窓0件 → []） ----
        List<String> windowSlidingEmpty = List.<String>of().stream()
                .gather(Gatherers.windowSliding(2))
                .map(w -> listLabel(w, OracleP7::stringLabel))
                .toList();

        // ---- 7. scan（int[]{3,1,4}をboxed。gatherはStream<T>のみ） ----
        int[] numbers = { 3, 1, 4 };
        List<String> scanSum = java.util.Arrays.stream(numbers)
                .boxed()
                .gather(Gatherers.scan(() -> 0, (acc, n) -> acc + n))
                .map(String::valueOf)
                .toList();

        // ---- 8. scan（空。v0.9 §7「導出」区分: 出力0件 → []） ----
        int[] noNumbers = {};
        List<String> scanEmpty = java.util.Arrays.stream(noNumbers)
                .boxed()
                .gather(Gatherers.scan(() -> 0, (acc, n) -> acc + n))
                .map(String::valueOf)
                .toList();

        // ---- 9. scan × stringConcat ----
        List<String> scanConcat = Stream.of("Java", "SQL", "Git")
                .gather(Gatherers.scan(() -> "", (acc, s) -> acc + s))
                .map(OracleP7::stringLabel)
                .toList();

        // ---- 10. fold → findFirst（salary合計） ----
        Optional<Long> foldSalary = employees.stream()
                .gather(Gatherers.fold(() -> 0L, (acc, e) -> acc + e.salary()))
                .findFirst();

        // ---- 11. fold（空。v0.9 §7「導出」区分: Optional[初期値]） ----
        Optional<Long> foldEmpty = noEmployees.stream()
                .gather(Gatherers.fold(() -> 0L, (acc, e) -> acc + e.salary()))
                .findFirst();

        // ---- OBSERVATION（組み込み4種 × 3項目 = 12行。厳密比較の対象外・観測記録） ----
        observe("windowFixed", Gatherers.windowFixed(3));
        observe("windowSliding", Gatherers.windowSliding(2));
        observe("scan", Gatherers.scan(() -> 0, (Integer acc, Integer n) -> acc + n));
        observe("fold", Gatherers.fold(() -> 0L, (Long acc, Employee e) -> acc + e.salary()));
        // 窓のunmodifiable性（v0.9 §3.2引用の裏取り。教材表示の根拠として観測記録に残す）
        boolean windowUnmodifiable;
        try {
            List<Employee> firstWindow = employees.stream()
                    .gather(Gatherers.windowFixed(3))
                    .findFirst()
                    .orElseThrow();
            firstWindow.add(employees.get(0));
            windowUnmodifiable = false;
        } catch (UnsupportedOperationException e) {
            windowUnmodifiable = true;
        }
        System.out.println("OBSERVATION: windowFixed.windowIsUnmodifiable=" + windowUnmodifiable);

        StringBuilder json = new StringBuilder("{");
        json.append("\"windowFixed3\":").append(jsonStrings(windowFixed3));
        json.append(",\"windowFixed2\":").append(jsonStrings(windowFixed2));
        json.append(",\"windowFixedEmpty\":").append(jsonStrings(windowFixedEmpty));
        json.append(",\"windowSliding2\":").append(jsonStrings(windowSliding2));
        json.append(",\"windowSlidingShort\":").append(jsonStrings(windowSlidingShort));
        json.append(",\"windowSlidingEmpty\":").append(jsonStrings(windowSlidingEmpty));
        json.append(",\"scanSum\":").append(jsonStrings(scanSum));
        json.append(",\"scanEmpty\":").append(jsonStrings(scanEmpty));
        json.append(",\"scanConcat\":").append(jsonStrings(scanConcat));
        json.append(",\"foldSalaryPresent\":").append(foldSalary.isPresent());
        json.append(",\"foldSalary\":").append(jsonString(longLiteral(foldSalary.orElseThrow())));
        json.append(",\"foldEmptyPresent\":").append(foldEmpty.isPresent());
        json.append(",\"foldEmpty\":").append(jsonString(longLiteral(foldEmpty.orElseThrow())));
        // gatherの出力要素はboxed型である（v0.9 §8.3の型適合表の裏取り。
        // Simulation Core側はTypeRefから同じ型名を導出する）
        String scanElementClass = java.util.Arrays.stream(numbers)
                .boxed()
                .gather(Gatherers.scan(() -> 0, (acc, n) -> acc + n))
                .findFirst()
                .orElseThrow()
                .getClass()
                .getSimpleName();
        json.append(",\"scanElementClass\":").append(jsonString(scanElementClass));
        String foldElementClass = foldSalary.orElseThrow().getClass().getSimpleName();
        json.append(",\"foldElementClass\":").append(jsonString(foldElementClass));
        json.append('}');
        System.out.println(json);
    }
}
