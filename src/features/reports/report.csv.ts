// Spreadsheet applications interpret leading formula markers even in quoted cells.
export const csvCell = (value: string) => {
  const safe = /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};
export const csv = (rows: readonly string[][]) => rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
