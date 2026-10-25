// BOT Thai QR Payment Standard transfer tag 29; amounts stay exact decimal strings.
export const crc16 = (value: string): string => {
  let crc = 0xffff;
  for (const char of value) {
    crc ^= char.charCodeAt(0) << 8;
    for (let bit = 0; bit < 8; bit++)
      crc = ((crc << 1) ^ ((crc & 0x8000) ? 0x1021 : 0)) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
};
const tlv = (tag: string, value: string) => `${tag}${String(value.length).padStart(2, "0")}${value}`;
export const promptpayPayload = (phone: string, amount: string): string => {
  if (!/^0[689]\d{8}$/.test(phone) || !/^(?:0|[1-9]\d{0,9})\.\d{2}$/.test(amount) || BigInt(amount.replace(".", "")) <= 0n)
    throw new RangeError("Invalid frozen PromptPay destination or amount");
  const payload = tlv("00", "01") + tlv("01", "12") + tlv("29", tlv("00", "A000000677010111") + tlv("01", `0066${phone.slice(1)}`)) + tlv("53", "764") + tlv("54", amount) + tlv("58", "TH") + "6304";
  return payload + crc16(payload);
};
