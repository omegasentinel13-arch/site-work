import { calculateHalfDayRate } from './money';

export interface AttendanceInput {
  roleId: string;
  roleName: string;
  categoryId: string;
  categoryName: string;
  rateInPaise: number;
  fullDayCount: number;
  halfDayCount: number;
}

export interface AttendanceCalculationResult {
  roleId: string;
  roleName: string;
  categoryId: string;
  categoryName: string;
  rateInPaise: number;
  fullDayCount: number;
  halfDayCount: number;
  totalWorkers: number;
  workerDays: number;
  fullDayCostPaise: number;
  halfDayCostPaise: number;
  totalCostPaise: number;
}

export interface CategorySummary {
  categoryId: string;
  categoryName: string;
  totalWorkers: number;
  workerDays: number;
  totalCostPaise: number;
  roles: AttendanceCalculationResult[];
}

export interface DailySummary {
  date: string;
  totalWorkers: number;
  fullDayCount: number;
  halfDayCount: number;
  workerDays: number;
  totalLabourCostPaise: number;
  categories: CategorySummary[];
}

/**
 * Calculates attendance metrics and integer paise cost for a single role.
 */
export function calculateRoleAttendance(input: AttendanceInput): AttendanceCalculationResult {
  const fullDay = Math.max(0, Math.floor(input.fullDayCount || 0));
  const halfDay = Math.max(0, Math.floor(input.halfDayCount || 0));
  const ratePaise = Math.max(0, Math.floor(input.rateInPaise || 0));

  const totalWorkers = fullDay + halfDay;
  const workerDays = fullDay + halfDay * 0.5;

  const fullDayCostPaise = fullDay * ratePaise;
  const halfDayRatePaise = calculateHalfDayRate(ratePaise);
  const halfDayCostPaise = halfDay * halfDayRatePaise;
  const totalCostPaise = fullDayCostPaise + halfDayCostPaise;

  return {
    roleId: input.roleId,
    roleName: input.roleName,
    categoryId: input.categoryId,
    categoryName: input.categoryName,
    rateInPaise: ratePaise,
    fullDayCount: fullDay,
    halfDayCount: halfDay,
    totalWorkers,
    workerDays,
    fullDayCostPaise,
    halfDayCostPaise,
    totalCostPaise,
  };
}

/**
 * Aggregates role attendance records for a specific day into category & daily summaries.
 */
export function calculateDailySummary(
  date: string,
  records: AttendanceInput[]
): DailySummary {
  let dailyTotalWorkers = 0;
  let dailyFullDay = 0;
  let dailyHalfDay = 0;
  let dailyWorkerDays = 0;
  let dailyTotalLabourCostPaise = 0;

  const categoryMap = new Map<string, { name: string; roles: AttendanceCalculationResult[] }>();

  for (const rec of records) {
    const calculated = calculateRoleAttendance(rec);
    dailyTotalWorkers += calculated.totalWorkers;
    dailyFullDay += calculated.fullDayCount;
    dailyHalfDay += calculated.halfDayCount;
    dailyWorkerDays += calculated.workerDays;
    dailyTotalLabourCostPaise += calculated.totalCostPaise;

    if (!categoryMap.has(rec.categoryId)) {
      categoryMap.set(rec.categoryId, {
        name: rec.categoryName,
        roles: [],
      });
    }
    categoryMap.get(rec.categoryId)!.roles.push(calculated);
  }

  const categories: CategorySummary[] = Array.from(categoryMap.entries()).map(
    ([catId, data]) => {
      const catWorkers = data.roles.reduce((sum, r) => sum + r.totalWorkers, 0);
      const catWorkerDays = data.roles.reduce((sum, r) => sum + r.workerDays, 0);
      const catCost = data.roles.reduce((sum, r) => sum + r.totalCostPaise, 0);

      return {
        categoryId: catId,
        categoryName: data.name,
        totalWorkers: catWorkers,
        workerDays: catWorkerDays,
        totalCostPaise: catCost,
        roles: data.roles,
      };
    }
  );

  return {
    date,
    totalWorkers: dailyTotalWorkers,
    fullDayCount: dailyFullDay,
    halfDayCount: dailyHalfDay,
    workerDays: dailyWorkerDays,
    totalLabourCostPaise: dailyTotalLabourCostPaise,
    categories,
  };
}

export interface DayAttendanceItem {
  date: string;
  fullDayCount: number;
  halfDayCount: number;
  totalWorkers: number;
  workerDays: number;
  totalCostPaise: number;
  rateInPaise: number;
}

export interface WeeklyMatrixRow {
  roleId: string;
  roleName: string;
  categoryId: string;
  categoryName: string;
  days: {
    date: string;
    dayOfWeek: string; // 'Mon', 'Tue', etc.
    fullDay: number;
    halfDay: number;
    totalWorkers: number;
    workerDays: number;
    costPaise: number;
  }[];
  totalFullDays: number;
  totalHalfDays: number;
  totalWorkerDays: number;
  totalCostPaise: number;
}
