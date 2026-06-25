import { describe, expect, it } from "vitest";
import { extractIswUkraineMapNotice, extractIswUkraineMapValue } from "../src/integrations/iswUkraineMap.js";

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
});
