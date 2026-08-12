import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.DoubleSummaryStatistics;
import java.util.IntSummaryStatistics;
import java.util.List;
import java.util.LongSummaryStatistics;
import java.util.stream.Collectors;

/**
 * P6-O01: Phase 6 手動連携の取込境界値の JDK 25 Oracle Test。
 *
 * 製品コードとは独立した固定Java 25コードで期待結果を実測し、
 * Simulation Core由来の期待値（expected-p6-from-core.json）と照合する。
 * 貼付候補のコード文字列は一切実行しない（入力値だけをここへ固定で書き写している）。
 *
 * 対象は Phase 6指示 §7.5 の数値値域の代表境界値:
 *   - int32境界（2,147,483,647 / -2,147,483,648）: sum / average / summaryStatistics
 *   - long safe integer境界（±9,007,199,254,740,991）: sum / summaryStatistics
 *   - doubleの 0 / 1e-6 / 1e15: boxed値の表示・summaryStatisticsのcount / min / max
 *   - Employee境界dataset（age 15 / 80、salary 0 / 99,999,999、evaluation 0.0 / 5.0）:
 *     Collectors.counting / summingInt / averagingInt / summingLong / averagingLong /
 *     summingDouble / averagingDouble
 *
 * 数値の表記合わせ（境界値選定の判断。docs/phase-6-decisions.md）:
 *   - double は {@link #coreDouble(double)} で Simulation Core の formatDoubleLiteral と
 *     同一の10進表記へ正規化する（Double.toStringは1e-3未満・1e7以上で指数表記へ切り替わるため）。
 *   - long は {@link #longLiteral(long)} で3桁区切り + L の表記へ揃える。
 *   - DoubleStream.sum() / average() は JDK が補償付き加算を用いる一方、
 *     Simulation Core の primitive Stream 集計は素朴加算のため照合対象に含めない。
 *     double集計の照合は Collectors 側（Core も補償付き）で行う。
 */
public class OracleP6 {

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

    /**
     * Simulation Coreの`formatDoubleLiteral`と同一の10進表記を生成する。
     * Double.toStringの最短往復表記から指数部を取り除き、整数値には`.0`を付す。
     */
    private static String coreDouble(double value) {
        String plain = new BigDecimal(Double.toString(value)).stripTrailingZeros().toPlainString();
        return plain.contains(".") ? plain : plain + ".0";
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

    private static String jsonStrings(List<String> values) {
        return values.stream().map(OracleP6::jsonString).collect(Collectors.joining(",", "[", "]"));
    }

    public static void main(String[] args) {
        // ---- int32境界 ----
        int[] intValues = { 2147483647, -2147483648 };
        int intSum = Arrays.stream(intValues).sum();
        double intAverage = Arrays.stream(intValues).average().orElseThrow();
        IntSummaryStatistics intStats = Arrays.stream(intValues).summaryStatistics();

        // ---- long safe integer境界 ----
        long[] longValues = { 9007199254740991L, -9007199254740991L };
        long longSum = Arrays.stream(longValues).sum();
        LongSummaryStatistics longStats = Arrays.stream(longValues).summaryStatistics();

        // ---- doubleの0 / 1e-6 / 1e15境界 ----
        double[] doubleValues = { 0.0, 1e-6, 1e15 };
        List<String> doubleBoxed =
                Arrays.stream(doubleValues).boxed().map(OracleP6::coreDouble).toList();
        DoubleSummaryStatistics doubleStats = Arrays.stream(doubleValues).summaryStatistics();

        // ---- Employee境界dataset ----
        Department qa = new Department("品質保証部", "技術本部");
        List<Employee> employees = List.of(
                new Employee("境界下限", 15, 0L, 0.0, "北",
                        LocalDate.of(1970, 1, 1), qa, List.of()),
                new Employee("境界上限", 80, 99_999_999L, 5.0, "南",
                        LocalDate.of(2100, 12, 31), qa, List.of("Java")));

        long employeeCount = employees.stream().collect(Collectors.counting());
        int summingIntAge = employees.stream().collect(Collectors.summingInt(Employee::age));
        double averagingIntAge = employees.stream().collect(Collectors.averagingInt(Employee::age));
        long summingLongSalary = employees.stream().collect(Collectors.summingLong(Employee::salary));
        double averagingLongSalary =
                employees.stream().collect(Collectors.averagingLong(Employee::salary));
        double summingDoubleEvaluation =
                employees.stream().collect(Collectors.summingDouble(Employee::evaluation));
        double averagingDoubleEvaluation =
                employees.stream().collect(Collectors.averagingDouble(Employee::evaluation));

        StringBuilder json = new StringBuilder("{");
        json.append("\"intBoundarySum\":").append(intSum);
        json.append(",\"intBoundaryAverage\":").append(jsonString(coreDouble(intAverage)));
        json.append(",\"intStatsCount\":").append(intStats.getCount());
        json.append(",\"intStatsSum\":").append(jsonString(longLiteral(intStats.getSum())));
        json.append(",\"intStatsMin\":").append(intStats.getMin());
        json.append(",\"intStatsMax\":").append(intStats.getMax());
        json.append(",\"intStatsAverage\":").append(jsonString(coreDouble(intStats.getAverage())));
        json.append(",\"longBoundarySum\":").append(jsonString(longLiteral(longSum)));
        json.append(",\"longStatsCount\":").append(longStats.getCount());
        json.append(",\"longStatsSum\":").append(jsonString(longLiteral(longStats.getSum())));
        json.append(",\"longStatsMin\":").append(jsonString(longLiteral(longStats.getMin())));
        json.append(",\"longStatsMax\":").append(jsonString(longLiteral(longStats.getMax())));
        json.append(",\"longStatsAverage\":").append(jsonString(coreDouble(longStats.getAverage())));
        json.append(",\"doubleBoxedValues\":").append(jsonStrings(doubleBoxed));
        json.append(",\"doubleStatsCount\":").append(doubleStats.getCount());
        json.append(",\"doubleStatsMin\":").append(jsonString(coreDouble(doubleStats.getMin())));
        json.append(",\"doubleStatsMax\":").append(jsonString(coreDouble(doubleStats.getMax())));
        json.append(",\"employeeCount\":").append(employeeCount);
        json.append(",\"summingIntAge\":").append(summingIntAge);
        json.append(",\"averagingIntAge\":").append(jsonString(coreDouble(averagingIntAge)));
        json.append(",\"summingLongSalary\":").append(summingLongSalary);
        json.append(",\"averagingLongSalary\":").append(jsonString(coreDouble(averagingLongSalary)));
        json.append(",\"summingDoubleEvaluation\":")
                .append(jsonString(coreDouble(summingDoubleEvaluation)));
        json.append(",\"averagingDoubleEvaluation\":")
                .append(jsonString(coreDouble(averagingDoubleEvaluation)));
        json.append('}');
        System.out.println(json);
    }
}
