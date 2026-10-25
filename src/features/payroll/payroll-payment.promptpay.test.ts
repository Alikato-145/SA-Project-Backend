import { expect, test } from "bun:test";
import { promptpayPayload, crc16 } from "./payroll-payment.promptpay";
test("CRC matches independent CCITT-FALSE check vector", () => expect(crc16("123456789")).toBe("29B1"));
test("phone TLV retains exact cents and maximum amount", () => {
  for (const amount of ["0.01", "123.45", "9999999999.99"]) {
    const payload = promptpayPayload("0812345678", amount);
    expect(payload).toContain("01130066812345678");
    expect(payload).toContain(`54${String(amount.length).padStart(2, "0")}${amount}`);
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  }
});
test("invalid phone and nonpositive/noncanonical amounts rejected", () => {
  for (const [phone, amount] of [["021234567", "1.00"], ["0812345678", "0.00"], ["0812345678", "1.001"], ["0812345678", "1e3"]])
    expect(() => promptpayPayload(phone!, amount!)).toThrow();
});
// Published upstream author test vector (static 0801234567); independent of our builder.
test("CRC matches published PromptPay author vector", () => expect(crc16("00020101021129370016A000000677010111011300668012345675802TH53037646304")).toBe("6197"));
import QRCode from "qrcode";
import jsQR from "jsqr";
const { PNG } = require("pngjs") as {
  PNG: {
    sync: {
      read(buffer: Buffer): {
        data: Buffer;
        width: number;
        height: number;
      };
    };
  };
};
test("independent decoder reads locally rendered PNG at one cent and maximum amount", async () => {
  for (const amount of ["0.01", "9999999999.99"]) {
    const png = PNG.sync.read(await QRCode.toBuffer(promptpayPayload("0812345678", amount), { type: "png", margin: 4, width: 640, errorCorrectionLevel: "M" }));
    const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
    expect(decoded).not.toBeNull();
    expect(decoded!.data).toContain("01130066812345678");
    expect(decoded!.data).toContain(`54${String(amount.length).padStart(2, "0")}${amount}`);
  }
});
