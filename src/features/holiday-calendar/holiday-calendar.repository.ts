import { and, eq } from "drizzle-orm";
import { db } from "../../core/db/client";
import type {
  CreateHolidayCommand,
  HolidayCalendar,
  UpdateHolidayCommand,
} from "./holiday-calendar.dto";
import { holidayCalendars } from "./holiday-calendar.schema";

export type HolidayCalendarRepository = {
  insert(command: CreateHolidayCommand & { createdByUserAccountId: number }): Promise<HolidayCalendar>;
  findById(id: number): Promise<HolidayCalendar | undefined>;
  list(shopId: number, options: { holidayDate?: string; activeOnly?: boolean }): Promise<HolidayCalendar[]>;
  update(id: number, command: UpdateHolidayCommand): Promise<HolidayCalendar | undefined>;
};

export class HolidayCalendarError extends Error {
  constructor(public readonly code: "HOLIDAY_ALREADY_EXISTS" | "HOLIDAY_NOT_FOUND" | "OUT_OF_SCOPE" | "INVALID_HOLIDAY") {
    super(code);
    this.name = "HolidayCalendarError";
  }
}

const databaseCode = (error: unknown) => {
  if (typeof error !== "object" || error === null) return undefined;
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  return typeof candidate.code === "string" ? candidate.code : candidate.cause?.code;
};

export class DrizzleHolidayCalendarRepository implements HolidayCalendarRepository {
  async insert(command: CreateHolidayCommand & { createdByUserAccountId: number }): Promise<HolidayCalendar> {
    try {
      const [holiday] = await db.insert(holidayCalendars).values(command).returning();
      return holiday;
    } catch (error) {
      if (databaseCode(error) === "23505") throw new HolidayCalendarError("HOLIDAY_ALREADY_EXISTS");
      throw error;
    }
  }

  async findById(id: number): Promise<HolidayCalendar | undefined> {
    return db.query.holidayCalendars.findFirst({ where: eq(holidayCalendars.id, id) });
  }

  async list(shopId: number, options: { holidayDate?: string; activeOnly?: boolean }): Promise<HolidayCalendar[]> {
    const filters = [eq(holidayCalendars.shopId, shopId)];
    if (options.holidayDate) filters.push(eq(holidayCalendars.holidayDate, options.holidayDate));
    if (options.activeOnly) filters.push(eq(holidayCalendars.isActive, true));
    return db.query.holidayCalendars.findMany({ where: and(...filters) });
  }

  async update(id: number, command: UpdateHolidayCommand): Promise<HolidayCalendar | undefined> {
    const [holiday] = await db
      .update(holidayCalendars)
      .set({ ...command, updatedAt: new Date() })
      .where(eq(holidayCalendars.id, id))
      .returning();
    return holiday;
  }
}
