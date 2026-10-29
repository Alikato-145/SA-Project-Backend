/** The employment end date takes effect at midnight in the business timezone. */
export const employmentAccessEnded = (date: string | null | undefined, now: Date): boolean => {
  if (!date) return false;
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  return date <= today;
};
