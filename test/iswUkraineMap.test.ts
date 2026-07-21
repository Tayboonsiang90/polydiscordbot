import { describe, expect, it } from "vitest";
import {
  extractIswUkraineMapNotice,
  extractIswUkraineMapNoticeFromStoryData,
  extractIswUkraineMapValue,
  iswUkraineMapShouldAlertOnChange
} from "../src/integrations/iswUkraineMap.js";

const sampleHtml = `
  <html>
    <head><meta property="article:published_time" content="2026-06-24T21:12:56.123Z"/></head>
    <body>
      <script>
        self.__next_f.push(["story",{"n-uMjGA4":{"type":"text","data":{"type":"paragraph","text":"ISW has completed updating our frontline geometry as of June 24, 2026, 5:00 PM ET. The map is finalized for June 24, 2026.","textAlignment":"center"}},"n-Otrveq":{"type":"text","data":{"type":"large-paragraph","text":"Assessed Control of Terrain in Ukraine \\nas of June 24, 2026, 5:00 PM ET","textAlignment":"center"}}}]);
      </script>
    </body>
  </html>
`;

describe("ISW Ukraine map adapter", () => {
  it("extracts the frontline geometry notice from StoryMaps HTML", () => {
    expect(extractIswUkraineMapNotice(sampleHtml)).toEqual({
      notice: "ISW has completed updating our frontline geometry as of June 24, 2026, 5:00 PM ET. The map is finalized for June 24, 2026.",
      assessedMapText: "Assessed Control of Terrain in Ukraine as of June 24, 2026, 5:00 PM ET",
      publishedAt: "2026-06-24T21:12:56.123Z"
    });
  });

  it("formats a stable monitored value", () => {
    expect(extractIswUkraineMapValue(sampleHtml)).toContain(
      "Notice: ISW has completed updating our frontline geometry as of June 24, 2026, 5:00 PM ET."
    );
    expect(extractIswUkraineMapValue(sampleHtml)).toContain("Map status: Assessed Control of Terrain in Ukraine as of June 24, 2026, 5:00 PM ET");
  });

  it("extracts the notice from ArcGIS StoryMap item data", () => {
    expect(
      extractIswUkraineMapNoticeFromStoryData({
        nodes: {
          "n-uMjGA4": {
            type: "text",
            data: {
              text: "ISW has completed updating our frontline geometry as of July 20, 2026 4:00 PM ET. The map is finalized for July 20, 2026."
            }
          },
          "n-Otrveq": {
            type: "text",
            data: {
              text: "Assessed Control of Terrain in Ukraine \nas of July 20, 2026, 4:00 PM ET"
            }
          }
        }
      })
    ).toEqual({
      notice: "ISW has completed updating our frontline geometry as of July 20, 2026 4:00 PM ET. The map is finalized for July 20, 2026.",
      assessedMapText: "Assessed Control of Terrain in Ukraine as of July 20, 2026, 4:00 PM ET",
      publishedAt: null
    });
  });

  it("does not alert when only optional StoryMaps publish metadata appears or disappears", () => {
    const withoutPublishedAt = [
      "Notice: ISW updates frontline geometry based on available open-source information starting at 9:00 AM Eastern Time.",
      "Map status: Assessed Control of Terrain in Ukraine as of July 20, 2026, 4:00 PM ET",
      "Resolution: https://storymaps.arcgis.com/stories/36a7f6a6f5a9448496de641cf64bd375"
    ].join("\n");
    const withPublishedAt = [
      "Notice: ISW updates frontline geometry based on available open-source information starting at 9:00 AM Eastern Time.",
      "Map status: Assessed Control of Terrain in Ukraine as of July 20, 2026, 4:00 PM ET",
      "Story published at: Jul 21, 2026, 08:41:57 ET",
      "Resolution: https://storymaps.arcgis.com/stories/36a7f6a6f5a9448496de641cf64bd375"
    ].join("\n");

    expect(iswUkraineMapShouldAlertOnChange(withoutPublishedAt, withPublishedAt)).toBe(false);
    expect(iswUkraineMapShouldAlertOnChange(withPublishedAt, withoutPublishedAt)).toBe(false);
  });

  it("alerts when the actual notice or map status changes", () => {
    const previous = [
      "Notice: ISW updates frontline geometry based on available open-source information starting at 9:00 AM Eastern Time.",
      "Map status: Assessed Control of Terrain in Ukraine as of July 20, 2026, 4:00 PM ET"
    ].join("\n");
    const current = [
      "Notice: ISW has completed updating our frontline geometry as of July 21, 2026, 5:00 PM ET. The map is finalized for July 21, 2026.",
      "Map status: Assessed Control of Terrain in Ukraine as of July 21, 2026, 5:00 PM ET"
    ].join("\n");

    expect(iswUkraineMapShouldAlertOnChange(previous, current)).toBe(true);
  });
});
