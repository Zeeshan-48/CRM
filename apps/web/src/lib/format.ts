// Formatting helpers shared across the app. Currency and number formats use
// the en-IN locale (lakh/crore digit grouping) to match the backend's INR data.

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

export const formatINR = (value: number | string | null | undefined): string => {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  return inrFormatter.format(Number.isFinite(n) ? n : 0);
};

export const formatNumber = (value: number | string | null | undefined): string => {
  const n = typeof value === "string" ? parseFloat(value) : (value ?? 0);
  return numberFormatter.format(Number.isFinite(n) ? n : 0);
};

export const formatDate = (
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }
): string => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-IN", options).format(date);
};

export const formatDateTime = (value: string | number | Date | null | undefined): string =>
  formatDate(value, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const timeAgo = (value: string | number | Date | null | undefined): string => {
  if (!value) return "never";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "never";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 45) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.round(days / 7)}w ago`;
  return formatDate(date);
};

export const initials = (name: string | null | undefined): string => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1][0] ?? "") : "";
  return (first + second).toUpperCase();
};
