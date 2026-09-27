const decimalPattern = /^(-?)(\d+)(?:\.(\d+))?$/;
const maxDigits = 30;

const power10 = (scale: number) => {
  if (!Number.isInteger(scale) || scale < 0 || scale > 8) throw new RangeError("Unsupported decimal scale");
  return 10n ** BigInt(scale);
};

export const parseFixed = (value: string, scale: number): bigint => {
  const match = decimalPattern.exec(value);
  if (!match || match[2].length + (match[3]?.length ?? 0) > maxDigits || (match[3]?.length ?? 0) > scale) {
    throw new RangeError("Invalid decimal value");
  }
  const factor = power10(scale);
  const fraction = (match[3] ?? "").padEnd(scale, "0");
  const parsed = BigInt(match[2]) * factor + BigInt(fraction || "0");
  return match[1] === "-" ? -parsed : parsed;
};

export const formatFixed = (value: bigint, scale: number): string => {
  const factor = power10(scale);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / factor;
  const fraction = scale === 0 ? "" : `.${String(absolute % factor).padStart(scale, "0")}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
};

export const divideHalfUp = (numerator: bigint, denominator: bigint): bigint => {
  if (denominator === 0n) throw new RangeError("Division by zero");
  const negative = (numerator < 0n) !== (denominator < 0n);
  const left = numerator < 0n ? -numerator : numerator;
  const right = denominator < 0n ? -denominator : denominator;
  const quotient = left / right;
  const rounded = quotient + ((left % right) * 2n >= right ? 1n : 0n);
  return negative ? -rounded : rounded;
};

export const multiplyFixed = (
  left: bigint,
  leftScale: number,
  right: bigint,
  rightScale: number,
  outputScale: number,
): bigint => {
  const inputScale = leftScale + rightScale;
  const product = left * right;
  if (inputScale === outputScale) return product;
  if (inputScale < outputScale) return product * power10(outputScale - inputScale);
  return divideHalfUp(product, power10(inputScale - outputScale));
};

export const rescaleHalfUp = (value: bigint, fromScale: number, toScale: number): bigint => {
  if (fromScale === toScale) return value;
  return fromScale < toScale
    ? value * power10(toScale - fromScale)
    : divideHalfUp(value, power10(fromScale - toScale));
};

export const money = (value: string) => parseFixed(value, 2);
export const rate = (value: string) => parseFixed(value, 4);
export const quantity = (value: string) => parseFixed(value, 2);
export const formatMoney = (value: bigint) => formatFixed(value, 2);
