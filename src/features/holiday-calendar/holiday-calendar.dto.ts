export type HolidayActor = { accountId: number };

export type CreateHolidayCommand = {
  shopId: number;
  holidayDate: string;
  name: string;
};

export type UpdateHolidayCommand = { name?: string; isActive?: boolean };

export type HolidayCalendar = CreateHolidayCommand & {
  id: number;
  isActive: boolean;
  createdByUserAccountId: number | null;
  createdAt: Date;
  updatedAt: Date;
};

export type HolidayCalendarResponse = Omit<
  HolidayCalendar,
  "createdByUserAccountId" | "createdAt" | "updatedAt"
>;
