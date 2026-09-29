import { realDate } from "../../shared/operation-validation";
import type {
  CreateHolidayCommand,
  HolidayActor,
  HolidayCalendar,
  UpdateHolidayCommand,
} from "./holiday-calendar.dto";
import { HolidayCalendarError, type HolidayCalendarRepository } from "./holiday-calendar.repository";

export type HolidayCalendarAccess = {
 assertCanReadShop?(actor:HolidayActor,shopId:number):Promise<void>;
  assertCanManageShop(actor: HolidayActor, shopId: number): Promise<void>;
};

export class HolidayCalendarService {
  constructor(private readonly repository: HolidayCalendarRepository, private readonly access: HolidayCalendarAccess) {}

  async createHoliday(actor: HolidayActor, command: CreateHolidayCommand): Promise<HolidayCalendar> {
    await this.access.assertCanManageShop(actor, command.shopId);
    this.assertCommand(command);
    return this.repository.insert({ ...command, createdByUserAccountId: actor.accountId });
  }

  async listHolidays(actor: HolidayActor, shopId: number, options: { holidayDate?: string; activeOnly?: boolean }) {
    await (this.access.assertCanReadShop ?? this.access.assertCanManageShop)(actor, shopId);
    if(options.holidayDate)realDate(options.holidayDate);return this.repository.list(shopId, options);
  }

  async findActiveHoliday(actor: HolidayActor, shopId: number, holidayDate: string) {
    await (this.access.assertCanReadShop ?? this.access.assertCanManageShop)(actor, shopId);
    return this.repository.list(shopId, { holidayDate, activeOnly: true });
  }

  async updateHoliday(actor: HolidayActor, id: number, command: UpdateHolidayCommand): Promise<HolidayCalendar> {
    const existing = await this.requireHoliday(id);
    await this.access.assertCanManageShop(actor, existing.shopId);
    if (command.name !== undefined && !command.name.trim()) throw new HolidayCalendarError("INVALID_HOLIDAY");
    return (await this.repository.update(id, command)) ?? this.notFound();
  }

  async deactivateHoliday(actor: HolidayActor, id: number): Promise<HolidayCalendar> {
    return this.updateHoliday(actor, id, { isActive: false });
  }

  async getActiveHoliday(shopId:number,date:string) { return this.repository.list(shopId,{holidayDate:date,activeOnly:true}); }

  private assertCommand(command: CreateHolidayCommand) {
    realDate(command.holidayDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(command.holidayDate) || !command.name.trim()) {
      throw new HolidayCalendarError("INVALID_HOLIDAY");
    }
  }

  private async requireHoliday(id: number) {
    return (await this.repository.findById(id)) ?? this.notFound();
  }

  private notFound(): never {
    throw new HolidayCalendarError("HOLIDAY_NOT_FOUND");
  }
}
