import{describe,expect,test}from"bun:test";import{ActionObserver}from"../../core/audit/action-observer";import{DomainAuditObserver}from"../../core/audit/domain-audit-observer";import type{AuthenticatedActor}from"../../core/auth/auth.types";import type{AuditEvent}from"../audit/audit.repository";import type{HolidayRecord,HolidayRepositoryPort}from"./employee-weekly-holiday.repository";import{createEmployeeWeeklyHolidayService}from"./employee-weekly-holiday.service";const owner:AuthenticatedActor={accountId:"9",employeeId:null,username:"o",grants:[{grantId:"1",roleCode:"OWNER",scope:"all",branchId:null,departmentId:null}]};const setup=()=>{const rows:HolidayRecord[]=[];const events:AuditEvent[]=[];const repo:HolidayRepositoryPort={async list(){return rows},async find(_e,emp,id){return rows.find(r=>r.employeeId===emp&&r.id===id)??null},async findLatest(_e,emp,w){return rows.filter(r=>r.employeeId===emp&&r.weekday===w).at(-1)??null},async findAtDate(_e,emp,d){return rows.filter(r=>r.employeeId===emp&&r.effectiveFrom<=d&&(r.effectiveTo===null||r.effectiveTo>=d))},async close(_e,id,to){const r=rows.find(x=>x.id===id&&x.effectiveTo===null);if(!r)return null;r.effectiveTo=to;return r},async insert(_e,input){const r={...input,id:String(rows.length+1)};rows.push(r);return r}};const writer={async insert(_e:never,event:AuditEvent){events.push(event);return{id:events.length,action:event.action,requestId:event.requestId}}};const s=createEmployeeWeeklyHolidayService({repository:repo,rootExecutor:{}as never,transactionRunner:{async transaction(w){return w({}as never)}},actions:new ActionObserver({}as never,writer as never),domain:new DomainAuditObserver(writer as never)});return{s,rows}};describe("weekly holiday history",()=>{test("accepts weekdays 0 and 6 and replaces inclusively",async()=>{const{s,rows}=setup();await s.add({actor:owner,requestId:"a",employeeId:"1",weekday:0,effectiveFrom:"2026-01-01",effectiveTo:null});await s.add({actor:owner,requestId:"b",employeeId:"1",weekday:0,effectiveFrom:"2026-02-01",effectiveTo:null});await s.add({actor:owner,requestId:"c",employeeId:"1",weekday:6,effectiveFrom:"2026-01-01",effectiveTo:null});expect(rows[0]?.effectiveTo).toBe("2026-01-31");expect(rows).toHaveLength(3)});test("rejects weekday/range overlap without rewriting start",async()=>{const{s,rows}=setup();await s.add({actor:owner,requestId:"a",employeeId:"1",weekday:1,effectiveFrom:"2026-01-10",effectiveTo:null});await expect(s.add({actor:owner,requestId:"b",employeeId:"1",weekday:1,effectiveFrom:"2026-01-10",effectiveTo:null})).rejects.toMatchObject({code:"EFFECTIVE_DATE_OVERLAP"});expect(rows[0]?.effectiveFrom).toBe("2026-01-10")})});

describe("weekly holiday historical lookup and atomic audit", () => {
  test("resolves inclusive historical dates before and after replacement", async () => {
    const { s } = setup();
    await s.add({ actor: owner, requestId: "first", employeeId: "1", weekday: 0, effectiveFrom: "2026-01-01", effectiveTo: null });
    await s.add({ actor: owner, requestId: "second", employeeId: "1", weekday: 0, effectiveFrom: "2026-02-01", effectiveTo: null });
    expect((await s.findAtDate("1", "2026-01-31"))[0]?.effectiveFrom).toBe("2026-01-01");
    expect((await s.findAtDate("1", "2026-02-01"))[0]?.effectiveFrom).toBe("2026-02-01");
  });

  test("rolls back holiday creation when success audit persistence fails", async () => {
    type State = { rows: HolidayRecord[]; events: AuditEvent[] };
    const root: State = { rows: [], events: [] };
    const state = (executor: unknown) => executor as State;
    const repo: HolidayRepositoryPort = {
      async list(executor) { return state(executor).rows; },
      async find(executor, employeeId, id) {
        return state(executor).rows.find((row) => row.employeeId === employeeId && row.id === id) ?? null;
      },
      async findLatest(executor, employeeId, weekday) {
        return state(executor).rows.filter((row) => row.employeeId === employeeId && row.weekday === weekday).at(-1) ?? null;
      },
      async findAtDate(executor, employeeId, date) {
        return state(executor).rows.filter((row) => row.employeeId === employeeId && row.effectiveFrom <= date && (row.effectiveTo === null || row.effectiveTo >= date));
      },
      async close(executor, id, effectiveTo) {
        const row = state(executor).rows.find((item) => item.id === id && item.effectiveTo === null);
        if (!row) return null;
        row.effectiveTo = effectiveTo;
        return row;
      },
      async insert(executor, input) {
        const rows = state(executor).rows;
        const row = { ...input, id: String(rows.length + 1) };
        rows.push(row);
        return row;
      },
    };
    const writer = {
      async insert(executor: never, event: AuditEvent) {
        if (event.action.endsWith(".succeeded")) throw new Error("audit unavailable");
        state(executor).events.push(event);
        return { id: state(executor).events.length, action: event.action, requestId: event.requestId };
      },
    };
    const service = createEmployeeWeeklyHolidayService({
      repository: repo,
      rootExecutor: root as never,
      transactionRunner: {
        async transaction(work) {
          const staged = structuredClone(root);
          const result = await work(staged as never);
          Object.assign(root, staged);
          return result;
        },
      },
      actions: new ActionObserver(root as never, writer as never, { error() {} }),
      domain: new DomainAuditObserver(writer as never),
    });

    await expect(service.add({
      actor: owner,
      requestId: "audit-failure",
      employeeId: "1",
      weekday: 6,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
    })).rejects.toThrow("audit unavailable");
    expect(root.rows).toEqual([]);
    expect(root.events.map((event) => event.action)).toEqual(["employee.holiday.create.failed"]);
  });
});
