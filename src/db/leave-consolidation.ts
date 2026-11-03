type LeavePolicy = { nameTh: string; quotaType: string; quotaDays: string | null; isDeductible: boolean; requiresDocument: boolean; allowExceed: boolean };

export function sameLeavePolicy(a: LeavePolicy, b: LeavePolicy): boolean {
  return a.nameTh === b.nameTh && a.quotaType === b.quotaType &&
    (a.quotaDays === null || b.quotaDays === null ? a.quotaDays === b.quotaDays : Number(a.quotaDays) === Number(b.quotaDays)) &&
    a.isDeductible === b.isDeductible && a.requiresDocument === b.requiresDocument && a.allowExceed === b.allowExceed;
}
