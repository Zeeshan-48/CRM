import { randomInt } from "crypto";

// Character sets for generated temp passwords. Ambiguous glyphs (0/O, 1/l/I)
// are intentionally excluded so the password is easy to read + retype from the
// invitation email.
const LOWER = "abcdefghijkmnpqrstuvwxyz"; // no l, o
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ"; // no I, O
const DIGITS = "23456789"; // no 0, 1
const ALL = LOWER + UPPER + DIGITS;

// Cryptographically-random temporary password with at least one lowercase,
// one uppercase and one digit, then shuffled so the guaranteed characters are
// not in fixed positions. Used for team-member invites (the member is expected
// to change it after first sign-in).
export const generateTempPassword = (length = 14): string => {
  const size = Math.max(8, length);
  const pick = (set: string): string => set[randomInt(set.length)];
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS)];
  for (let i = chars.length; i < size; i++) chars.push(pick(ALL));
  // Fisher-Yates shuffle with a CSPRNG.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
};
