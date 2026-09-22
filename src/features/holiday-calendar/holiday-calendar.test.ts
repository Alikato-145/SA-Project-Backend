import { describe, expect, test } from "bun:test";
import type { HolidayCalendar } from "./holiday-calendar.dto";
import { HolidayCalendarError, type HolidayCalendarRepository } from "./holiday-calendar.repository";
import { HolidayCalendarService } from "./holiday-calendar.service";

const holiday: HolidayCalendar = {
  id: 1, shopId: 5, holidayDate: "2026-12-31", name: "New Year", isActive: true,
  createdByUserAccountId: 7, createdAt: new Date(), updatedAt: new Date(),
};

const repository = (): HolidayCalendarRepository & { insertCalls: number } => ({
  insertCalls: 0,
  async insert(command) { this.insertCalls += 1; return { ...holiday, ...command }; },
  async findById() { return holiday; },
  async list(_shopId, options) { return options.activeOnly ? [holiday] : [holiday]; },
  async update(_id, command) { return { ...holiday, ...command }; },
});

describe("HolidayCalendarService", () => {
  test("denies an out-of-scope actor before persistence", async () => {
    const store = repository();
    const service = new HolidayCalendarService(store, { async assertCanManageShop() { throw new HolidayCalendarError("OUT_OF_SCOPE"); } });
    await expect(service.createHoliday({ accountId: 7 }, { shopId: 5, holidayDate: "2026-12-31", name: "New Year" }))
      .rejects.toMatchObject({ code: "OUT_OF_SCOPE" });
    expect(store.insertCalls).toBe(0);
  });

  test("preserves duplicate conflicts from persistence", async () => {
    const store = repository();
    store.insert = async () => { throw new HolidayCalendarError("HOLIDAY_ALREADY_EXISTS"); };
    const service = new HolidayCalendarService(store, { async assertCanManageShop() {} });
    await expect(service.createHoliday({ accountId: 7 }, { shopId: 5, holidayDate: "2026-12-31", name: "New Year" }))
      .rejects.toMatchObject({ code: "HOLIDAY_ALREADY_EXISTS" });
  });

  test("returns active holidays and excludes an inactive entry", async () => {
    const store = repository();
    let active = true;
    store.list = async (_shopId, options) => options.activeOnly && !active ? [] : [{ ...holiday, isActive: active }];
    store.update = async (_id, command) => { active = command.isActive ?? active; return { ...holiday, ...command }; };
    const service = new HolidayCalendarService(store, { async assertCanManageShop() {} });
    await expect(service.findActiveHoliday({ accountId: 7 }, 5, "2026-12-31")).resolves.toHaveLength(1);
    await service.deactivateHoliday({ accountId: 7 }, 1);
    await expect(service.findActiveHoliday({ accountId: 7 }, 5, "2026-12-31")).resolves.toEqual([]);
  });
});
