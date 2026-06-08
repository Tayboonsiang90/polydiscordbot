import { describe, expect, it } from "vitest";
import {
  extractIkaDepartures,
  formatIkaDepartureValue,
  ikaDeparturesAdapter
} from "../src/integrations/ikaDepartures.js";

const sampleHtml = `
  <table class="fullWidth airportBoard" data-type="departures">
    <thead>
      <tr><th colspan="6" class="mainHeader"><h2>Departures <span>(<a href="/live/airport/OIIE/departures">More</a>)</span></h2></th></tr>
      <tr class="secondaryHeader"><th>Ident</th><th>Type</th><th>To</th><th>Depart</th><th></th><th>Arrive</th></tr>
    </thead>
    <tbody>
      <tr id="Row_outbound_IRM77">
        <td class="flight-ident"><span title="Mahan Air"><a href="/live/flight/IRM77/history/20260607/1750Z/OIIE/ZSPD">IRM77</a></span></td>
        <td><span title="Airbus A340-300"><a href="/live/aircrafttype/A343">A343</a></span></td>
        <td><span class="hint" title="Shanghai Pudong Int'l (Shanghai) - PVG"><span dir="ltr">Shanghai Pudong Int'l</span></span> <span dir="ltr">(<a href="/live/airport/ZSPD">PVG</a>)</span></td>
        <td>22:37&nbsp;<span class="tz">+0330</span></td>
        <td><div class="track-panel-progress"></div></td>
        <td>11:01&nbsp;<span class="tz">CST</span></td>
      </tr>
      <tr id="Row_outbound_IRA1678">
        <td class="flight-ident"><a href="/live/flight/IRA1678/history/20260607/1635Z/OIIE/OEJN">IRA1678</a></td>
        <td>A332</td>
        <td>King Abdulaziz Int'l (<a href="/live/airport/OEJN">JED</a>)</td>
        <td>20:05 <span class="tz">+0330</span></td>
        <td></td>
        <td>22:49 <span class="tz">+03</span></td>
      </tr>
      <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td></td><td>&nbsp;</td></tr>
    </tbody>
  </table>
`;

describe("IKA departures adapter", () => {
  it("extracts live FlightAware Departures rows", () => {
    expect(extractIkaDepartures(sampleHtml)).toEqual([
      {
        id: "/live/flight/IRM77/history/20260607/1750Z/OIIE/ZSPD",
        ident: "IRM77",
        aircraftType: "A343",
        destination: "Shanghai Pudong Int'l (PVG)",
        depart: "22:37 +0330",
        arrive: "11:01 CST",
        url: "https://www.flightaware.com/live/flight/IRM77/history/20260607/1750Z/OIIE/ZSPD"
      },
      {
        id: "/live/flight/IRA1678/history/20260607/1635Z/OIIE/OEJN",
        ident: "IRA1678",
        aircraftType: "A332",
        destination: "King Abdulaziz Int'l (JED)",
        depart: "20:05 +0330",
        arrive: "22:49 +03",
        url: "https://www.flightaware.com/live/flight/IRA1678/history/20260607/1635Z/OIIE/OEJN"
      }
    ]);
  });

  it("formats departure values for Discord", () => {
    expect(formatIkaDepartureValue(extractIkaDepartures(sampleHtml)[0])).toContain("Ident: IRM77");
  });

  it("supports event updates for new departure alerts", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(sampleHtml, { status: 200, headers: { "content-type": "text/html" } });
    try {
      expect(ikaDeparturesAdapter.fetchEventUpdates).toBeDefined();
      const result = await ikaDeparturesAdapter.fetchEventUpdates!({} as never);
      expect(result.posts).toHaveLength(2);
      expect(result.posts[0]).toMatchObject({
        id: "/live/flight/IRM77/history/20260607/1750Z/OIIE/ZSPD",
        alertTitle: "New IKA departure listed",
        mentionAlertRole: true
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
