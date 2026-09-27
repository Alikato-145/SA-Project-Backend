import type { CreateHolidayCommand, HolidayActor, UpdateHolidayCommand } from "./holiday-calendar.dto";
import { toHolidayCalendarResponse } from "./holiday-calendar.mapper";
import { HolidayCalendarError } from "./holiday-calendar.repository";
import { HolidayCalendarService } from "./holiday-calendar.service";

const id = (value: string | number) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new HolidayCalendarError("INVALID_HOLIDAY");
  return parsed;
};

export class HolidayCalendarController {
  constructor(private readonly service: HolidayCalendarService) {}
  async create(input: { actor: HolidayActor; command: CreateHolidayCommand }) {
    return toHolidayCalendarResponse(await this.service.createHoliday(input.actor, { ...input.command, shopId: id(input.command.shopId) }));
  }
  async list(input: { actor: HolidayActor; shopId: string | number; holidayDate?: string; activeOnly?: boolean | string }) {
    const activeOnly = input.activeOnly === true || input.activeOnly === "true";
    return (await this.service.listHolidays(input.actor, id(input.shopId), { holidayDate: input.holidayDate, activeOnly })).map(toHolidayCalendarResponse);
  }
  async update(input: { actor: HolidayActor; id: string | number; command: UpdateHolidayCommand }) {
    return toHolidayCalendarResponse(await this.service.updateHoliday(input.actor, id(input.id), input.command));
  }
}
