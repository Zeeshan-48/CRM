/**
 * Converts a numeric amount into Indian Currency words.
 * Example: 15340 -> "Fifteen Thousand Three Hundred Forty Rupees Only"
 */
export function amountToINRWords(amount: number): string {
  if (!amount || isNaN(amount) || amount === 0) {
    return "Zero Rupees Only";
  }

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];

  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ];

  function convertTwoDigits(n: number): string {
    if (n < 20) return ones[n];
    const t = Math.floor(n / 10);
    const o = n % 10;
    return `${tens[t]}${o ? " " + ones[o] : ""}`;
  }

  function convertThreeDigits(n: number): string {
    const h = Math.floor(n / 100);
    const rem = n % 100;
    let res = "";
    if (h) res += `${ones[h]} Hundred`;
    if (rem) {
      if (res) res += " ";
      res += convertTwoDigits(rem);
    }
    return res;
  }

  const rounded = Math.round(amount);
  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const hundred = rounded % 1000;

  const parts: string[] = [];

  if (crore) parts.push(`${convertTwoDigits(crore)} Crore`);
  if (lakh) parts.push(`${convertTwoDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${convertTwoDigits(thousand)} Thousand`);
  if (hundred) parts.push(convertThreeDigits(hundred));

  return `${parts.join(" ")} Rupees Only`;
}

