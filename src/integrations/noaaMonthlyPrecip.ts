export type NoaaMonthlyPrecipSettings = {
  year: number;
  month: number;
};

export type NoaaMonthlyPrecipResponse = {
  data?: Array<[string, string]>;
  error?: string;
};

export function extractNoaaMonthlyPrecipitationValue(
  response: NoaaMonthlyPrecipResponse,
  settings: NoaaMonthlyPrecipSettings,
  locationLabel: string
): string {
  if (response.error) {
    throw new Error(`NOAA returned error: ${response.error}`);
  }

  const period = `${settings.year}-${padMonth(settings.month)}`;
  const rows = normalizeDailyRows(response.data ?? [], period);
  const reportedRows = rows.filter((row) => row.rawValue !== "M");
  if (reportedRows.length === 0) {
    return [
      "Metric: NOAA monthly precipitation",
      `Location: ${locationLabel}`,
      `Period: ${period}`,
      "Status: not published yet",
      `Reported days: 0/${lastDayOfMonth(settings)}`,
      "Total precipitation: not published yet",
      "Latest reported day: none",
      "Latest day value: none",
      "Daily values: none"
    ].join("\n");
  }

  const total = reportedRows.reduce((sum, row) => sum + row.numericValue, 0);
  const latestReported = reportedRows.at(-1);
  const expectedDays = lastDayOfMonth(settings);
  const status = reportedRows.length >= expectedDays ? "complete" : "partial";

  return [
    `Metric: NOAA monthly precipitation`,
    `Location: ${locationLabel}`,
    `Period: ${period}`,
    `Status: ${status}`,
    `Reported days: ${reportedRows.length}/${expectedDays}`,
    `Total precipitation: ${formatPrecipitationTotal(total)} inches`,
    `Latest reported day: ${latestReported?.date ?? "none"}`,
    `Latest day value: ${latestReported ? formatPrecipitationValue(latestReported.rawValue) : "none"} inches`,
    `Daily values: ${reportedRows.map((row) => `${row.date}: ${formatPrecipitationValue(row.rawValue)}`).join(" | ")}`
  ].join("\n");
}

export function buildNoaaMonthlyPrecipRequestBody(stationId: string, settings: NoaaMonthlyPrecipSettings): URLSearchParams {
  const params = {
    sid: stationId,
    sdate: `${settings.year}-${padMonth(settings.month)}-01`,
    edate: `${settings.year}-${padMonth(settings.month)}-${String(lastDayOfMonth(settings)).padStart(2, "0")}`,
    elems: [{ name: "pcpn" }]
  };

  return new URLSearchParams({
    params: JSON.stringify(params),
    output: "json"
  });
}

export function isValidNoaaMonthlyPrecipPeriod(year: number, month: number): boolean {
  return Number.isInteger(year) && Number.isInteger(month) && year >= 1900 && year <= 2100 && month >= 1 && month <= 12;
}

function normalizeDailyRows(data: Array<[string, string]>, period: string): Array<{ date: string; rawValue: string; numericValue: number }> {
  return data.flatMap(([date, rawValue]) => {
    if (!date.startsWith(`${period}-`) || !rawValue) {
      return [];
    }

    const normalizedValue = normalizePrecipitationValue(rawValue);
    return [
      {
        date,
        rawValue: normalizedValue,
        numericValue: normalizedValue === "T" ? 0 : Number(normalizedValue)
      }
    ];
  });
}

function normalizePrecipitationValue(value: string): string {
  if (value === "T" || value === "M") {
    return value;
  }

  const numericValue = Number(value);
  if (!Number.isFinite(numericValue) || numericValue < 0 || numericValue >= 100) {
    throw new Error(`Invalid NOAA monthly precipitation value: ${value}`);
  }

  return numericValue.toFixed(2);
}

function formatPrecipitationValue(value: string): string {
  return value === "T" ? "T" : Number(value).toFixed(2);
}

function formatPrecipitationTotal(value: number): string {
  return value.toFixed(2);
}

function lastDayOfMonth(settings: NoaaMonthlyPrecipSettings): number {
  return new Date(settings.year, settings.month, 0).getDate();
}

function padMonth(month: number): string {
  return String(month).padStart(2, "0");
}
