import java.time.LocalDate;
import java.util.List;
import java.util.stream.Collectors;

/**
 * P1-O01: JDK 25 Oracle Test（Draft v0.8 §24.4、J-1）。
 * 製品コードとは別の固定Javaコードで期待結果を生成し、Simulation Coreの結果と照合する。
 * fixtureはDraft v0.8 §21.3のEmployee 4件を値・順序のまま使用する。
 */
public class OracleP1 {

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

    private static String toJsonArray(List<Employee> employees) {
        return employees.stream()
                .map(e -> "\"" + e.name() + "\"")
                .collect(Collectors.joining(",", "[", "]"));
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

        // 標準: age >= 30
        List<Employee> standard = employees.stream()
                .filter(e -> e.age() >= 30)
                .toList();

        // 途中0件: 全件false（age >= 100）
        List<Employee> midEmpty = employees.stream()
                .filter(e -> e.age() >= 100)
                .toList();

        // 空ソース: 入力0件
        List<Employee> emptySource = List.<Employee>of().stream()
                .filter(e -> e.age() >= 30)
                .toList();

        // 横スクロール検証template: filter 5段チェーン
        List<Employee> chain = employees.stream()
                .filter(e -> e.age() >= 25)
                .filter(e -> e.age() >= 28)
                .filter(e -> e.age() >= 30)
                .filter(e -> e.age() >= 35)
                .filter(e -> e.age() >= 40)
                .toList();

        // Stream.toList()のunmodifiable性（§16.4）
        boolean unmodifiable;
        try {
            standard.add(null);
            unmodifiable = false;
        } catch (UnsupportedOperationException e) {
            unmodifiable = true;
        }

        System.out.println("{"
                + "\"standard\":" + toJsonArray(standard) + ","
                + "\"midEmpty\":" + toJsonArray(midEmpty) + ","
                + "\"emptySource\":" + toJsonArray(emptySource) + ","
                + "\"chain\":" + toJsonArray(chain) + ","
                + "\"standardUnmodifiable\":" + unmodifiable
                + "}");
    }
}
