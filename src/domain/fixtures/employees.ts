import type { DatasetElement, DepartmentValue } from '../model/employee'
import { deepFreeze } from '../util/deepFreeze'

/**
 * Phase 1の基準fixture（Draft v0.8 §21.3）。
 * 値・順序を仕様のまま使用する。elementIdは安定ID（emp-001等）。
 */
const development: DepartmentValue = { name: '開発部', division: '技術本部' }
const sales: DepartmentValue = { name: '営業部', division: '営業本部' }

export const STANDARD_EMPLOYEES: readonly DatasetElement[] = deepFreeze([
  {
    elementId: 'emp-001',
    value: {
      name: '佐藤',
      age: 35,
      salary: 5_500_000,
      evaluation: 4.2,
      region: '関東',
      hireDate: '2022-04-01',
      department: development,
      skills: ['Java', 'SQL'],
    },
  },
  {
    elementId: 'emp-002',
    value: {
      name: '鈴木',
      age: 27,
      salary: 4_200_000,
      evaluation: 3.8,
      region: '関西',
      hireDate: '2023-10-01',
      department: sales,
      skills: ['営業', '英語'],
    },
  },
  {
    elementId: 'emp-003',
    value: {
      name: '高橋',
      age: 42,
      salary: 7_200_000,
      evaluation: 4.6,
      region: '関東',
      hireDate: '2018-07-15',
      department: development,
      skills: ['Java', '設計'],
    },
  },
  {
    elementId: 'emp-004',
    value: {
      name: '田中',
      age: 29,
      salary: 4_800_000,
      evaluation: 4.0,
      region: '中部',
      hireDate: '2021-01-05',
      department: sales,
      skills: ['SQL', '分析'],
    },
  },
])

export const EMPTY_EMPLOYEES: readonly DatasetElement[] = deepFreeze([])
