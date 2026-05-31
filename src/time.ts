const singaporeFormatter = new Intl.DateTimeFormat("en-SG", {
  timeZone: "Asia/Singapore",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export function formatSingaporeDateTime(value: Date | string | null): string {
  if (!value) {
    return "never";
  }

  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "invalid date";
  }

  return `${singaporeFormatter.format(date)} SGT`;
}

export function nowSingaporeDateTime(): string {
  return formatSingaporeDateTime(new Date());
}
