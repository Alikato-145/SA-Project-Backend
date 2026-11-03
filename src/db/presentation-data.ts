export const presentationBranches = [
  { code: "RAM", name: "สาขารามอินทรา" },
  { code: "PAK", name: "สาขาปากเกร็ด" },
  { code: "NON", name: "สาขานนทบุรี" },
] as const;

const firstNames = ["ณัฐชา", "พิมพ์ชนก", "ธนกฤต", "กิตติพงศ์", "ศิริพร", "อรทัย", "ณัฐวุฒิ", "สุภาวดี", "ปิยะวัฒน์", "ชนัญชิดา", "ชุติมา", "ธีรภัทร", "วรัญญา", "กานต์พิชชา", "ภัทรพล", "สุรเชษฐ์", "นภัสสร", "วรรณวิสา", "ปฏิภาณ", "กมลชนก"];
const lastNames = ["วัฒนกุล", "ศรีวิไล", "ใจดี", "บุญมี", "แสงทอง", "สุขใจ", "พงษ์ศิริ", "ทองดี", "บุญช่วย", "จันทร์เพ็ญ", "วงศ์สวัสดิ์", "ศรีสุข", "ชูศรี", "อินทร์แก้ว", "มีชัย", "สวัสดิ์ผล", "ศรีประเสริฐ", "พูนทรัพย์", "ศรีสกุล", "มั่นคง"];

export const presentationEmployees = presentationBranches.flatMap((branch, branchIndex) =>
  firstNames.map((firstName, index) => ({
    code: `HP-${branch.code}-${String(index + 1).padStart(3, "0")}`,
    branchCode: branch.code,
    firstName,
    lastName: lastNames[(index + branchIndex * 7) % lastNames.length]!,
  })),
);
