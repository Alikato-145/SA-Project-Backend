import type { HolidayCalendar, HolidayCalendarResponse } from "./holiday-calendar.dto";

export const toHolidayCalendarResponse = (holiday: HolidayCalendar): HolidayCalendarResponse => ({
  id: holiday.id,
  shopId: holiday.shopId,
  holidayDate: holiday.holidayDate,
  name: holiday.name,
  isActive: holiday.isActive,
});
