import { PeriodPreset, ResolvedPeriod } from './types';

function formatDate(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

export function resolveExportPeriod(
  preset: PeriodPreset,
  customFrom?: string,
  customTo?: string,
  actualBounds?: { earliestDate?: string | null; latestDate?: string | null }
): ResolvedPeriod {
  const now = new Date();

  switch (preset) {
    case 'ALL_DATA': {
      const start = actualBounds?.earliestDate || undefined;
      const end = actualBounds?.latestDate || undefined;
      const label = start && end 
        ? `All Data (${start} to ${end})`
        : 'All Data (Full Recorded History)';
      return {
        preset: 'ALL_DATA',
        startDate: start,
        endDate: end,
        label,
        isUnbounded: true,
      };
    }

    case 'TODAY': {
      const today = formatDate(now);
      return {
        preset: 'TODAY',
        startDate: today,
        endDate: today,
        label: `Today (${today})`,
        isUnbounded: false,
      };
    }

    case 'LAST_7_DAYS': {
      const end = formatDate(now);
      const startD = new Date(now);
      startD.setDate(startD.getDate() - 6);
      const start = formatDate(startD);
      return {
        preset: 'LAST_7_DAYS',
        startDate: start,
        endDate: end,
        label: `Last 7 Days (${start} to ${end})`,
        isUnbounded: false,
      };
    }

    case 'LAST_30_DAYS': {
      const end = formatDate(now);
      const startD = new Date(now);
      startD.setDate(startD.getDate() - 29);
      const start = formatDate(startD);
      return {
        preset: 'LAST_30_DAYS',
        startDate: start,
        endDate: end,
        label: `Last 30 Days (${start} to ${end})`,
        isUnbounded: false,
      };
    }

    case 'THIS_MONTH': {
      const year = now.getFullYear();
      const month = now.getMonth();
      const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return {
        preset: 'THIS_MONTH',
        startDate: start,
        endDate: end,
        label: `${MONTH_NAMES[month]} ${year}`,
        isUnbounded: false,
      };
    }

    case 'PREVIOUS_MONTH': {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const year = prev.getFullYear();
      const month = prev.getMonth();
      const start = `${year}-${String(month + 1).padStart(2, '0')}-01`;
      const lastDay = new Date(year, month + 1, 0).getDate();
      const end = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      return {
        preset: 'PREVIOUS_MONTH',
        startDate: start,
        endDate: end,
        label: `${MONTH_NAMES[month]} ${year}`,
        isUnbounded: false,
      };
    }

    case 'THIS_YEAR': {
      const year = now.getFullYear();
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      return {
        preset: 'THIS_YEAR',
        startDate: start,
        endDate: end,
        label: `Calendar Year ${year}`,
        isUnbounded: false,
      };
    }

    case 'PREVIOUS_YEAR': {
      const year = now.getFullYear() - 1;
      const start = `${year}-01-01`;
      const end = `${year}-12-31`;
      return {
        preset: 'PREVIOUS_YEAR',
        startDate: start,
        endDate: end,
        label: `Calendar Year ${year}`,
        isUnbounded: false,
      };
    }

    case 'CUSTOM': {
      const start = customFrom;
      const end = customTo;
      if (!start || !end) {
        throw new Error('Custom date range requires both start and end dates');
      }
      return {
        preset: 'CUSTOM',
        startDate: start,
        endDate: end,
        label: `Custom Range (${start} to ${end})`,
        isUnbounded: false,
      };
    }

    default:
      throw new Error(`Unknown period preset: ${preset}`);
  }
}
