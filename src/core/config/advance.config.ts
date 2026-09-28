export const advanceThresholds = () => {
 const requestDay=Number(process.env.ADVANCE_REQUEST_DAY ?? 20);
 const workedDays=Number(process.env.ADVANCE_MIN_WORKED_DAYS ?? 20);
 const salaryRatio=process.env.ADVANCE_SALARY_RATIO ?? "0.5000";
 if(!Number.isInteger(requestDay)||requestDay<1||requestDay>31||!Number.isInteger(workedDays)||workedDays<1||!/^0\.\d{1,4}$/.test(salaryRatio))throw new Error("Invalid advance eligibility configuration");
 return {requestDay,workedDays,salaryRatio};
};
