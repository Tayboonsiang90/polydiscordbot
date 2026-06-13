import { describe, expect, it } from "vitest";
import {
  buildPortwatchBabElMandebApiUrl,
  formatPortwatchBabElMandebValue,
  normalizePortwatchBabElMandebRows
} from "../src/integrations/portwatchBabElMandeb.js";

const rows = normalizePortwatchBabElMandebRows({
  features: [
    {
      attributes: {
        date: "2026-06-01",
        portid: "chokepoint4",
        portname: "Bab el-Mandeb Strait",
        n_total: 38,
        ObjectId: 10056
      }
    },
    {
      attributes: {
        date: "2026-06-02",
        portid: "chokepoint4",
        portname: "Bab el-Mandeb Strait",
        n_total: 36,
        ObjectId: 10057
      }
    },
    {
      attributes: {
        date: "2026-06-03",
        portid: "chokepoint28",
        portname: "Kerch Strait",
        n_total: 99,
        ObjectId: 1
      }
    }
  ]
});

describe("IMF Portwatch Bab el-Mandeb adapter", () => {
  it("queries the official Bab el-Mandeb chokepoint rows", () => {
    expect(buildPortwatchBabElMandebApiUrl()).toContain("portid%3D%27chokepoint4%27");
  });

  it("normalizes only Bab el-Mandeb daily rows", () => {
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2026-06-01", n_total: 38, ObjectId: 10056 });
    expect(rows[1]).toMatchObject({ date: "2026-06-02", n_total: 36, ObjectId: 10057 });
  });

  it("formats latest arrivals and moving averages", () => {
    expect(formatPortwatchBabElMandebValue(rows)).toContain(
      [
        "Metric: IMF Portwatch Bab el-Mandeb arrivals of ships",
        "Latest data date: 2026-06-02",
        "Latest arrivals: 36",
        "Latest ObjectId: 10057",
        "7-day moving average: 37.0",
        "14-day average: 37.0",
        "14-day low: 36 on 2026-06-02",
        "Last 14 daily arrivals: 2026-06-01: 38 | 2026-06-02: 36"
      ].join("\n")
    );
  });
});
