import type { DatasetElement, DepartmentValue } from '../model/employee'
import { deepFreeze } from '../util/deepFreeze'

/**
 * Phase 8 merge実演用の補助Employeeデータセット（Phase 8指示 §7.6、v0.11 §8.6-4）。
 *
 * 基準4件（`STANDARD_EMPLOYEES`）では同一regionの衝突が最大2件（関東×2）にとどまり、
 * v0.11 §8.6-4の「同一キーへ3件以上が衝突するデータ」（mergeの順次適用の可視化）を
 * 満たせないため、**関東3件を含む5件**を新設した。
 *
 * 部署recordは既存fixtureと同形（開発部 / 技術本部、営業部 / 営業本部）とし、
 * Javaコード表示の部署変数名（development / sales）が既存規約のまま解決されるようにする。
 * elementIdは既存`emp-001`〜`emp-004`と衝突しない`emp-101`〜`emp-105`とする。
 *
 * このデータセットは`collectionId: 'employeesMergeDemo'`のtemplate / fixtureからのみ使用する。
 * 既存`STANDARD_EMPLOYEES`の値・順序・elementIdは一切変更していない。
 */
const development: DepartmentValue = { name: '開発部', division: '技術本部' }
const sales: DepartmentValue = { name: '営業部', division: '営業本部' }

export const MERGE_DEMO_EMPLOYEES: readonly DatasetElement[] = deepFreeze([
  {
    elementId: 'emp-101',
    value: {
      name: '伊藤',
      age: 31,
      salary: 5_000_000,
      evaluation: 4.1,
      region: '関東',
      hireDate: '2020-04-01',
      department: development,
      skills: ['Java', 'AWS'],
    },
  },
  {
    elementId: 'emp-102',
    value: {
      name: '渡辺',
      age: 38,
      salary: 6_100_000,
      evaluation: 4.4,
      region: '関東',
      hireDate: '2016-10-01',
      department: development,
      skills: ['設計', 'SQL'],
    },
  },
  {
    elementId: 'emp-103',
    value: {
      name: '山本',
      age: 26,
      salary: 4_600_000,
      evaluation: 3.9,
      region: '関東',
      hireDate: '2024-04-01',
      department: sales,
      skills: ['営業', 'SQL'],
    },
  },
  {
    elementId: 'emp-104',
    value: {
      name: '中村',
      age: 33,
      salary: 5_200_000,
      evaluation: 4.0,
      region: '関西',
      hireDate: '2019-07-01',
      department: sales,
      skills: ['営業', '英語'],
    },
  },
  {
    elementId: 'emp-105',
    value: {
      name: '小林',
      age: 30,
      salary: 4_900_000,
      evaluation: 3.7,
      region: '中部',
      hireDate: '2021-10-01',
      department: development,
      skills: ['Java', '分析'],
    },
  },
])
