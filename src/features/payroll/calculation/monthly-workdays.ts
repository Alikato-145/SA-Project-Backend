/** Count each calendar date once even when several kinds of holiday overlap. */
export function countMonthlyWorkDays(
  dates: readonly string[],
  holidays: {
    weekly: readonly { weekday: number; effectiveFrom: string; effectiveTo: string | null }[];
    publicDates: readonly string[];
    closedDates: readonly string[];
  },
): number {
  const publicDays = new Set(holidays.publicDates);
  const closedDays = new Set(holidays.closedDates);
  return new Set(dates.filter((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return !publicDays.has(date) && !closedDays.has(date) && !holidays.weekly.some((row) =>
      row.weekday === weekday && row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date));
  })).size;
}
