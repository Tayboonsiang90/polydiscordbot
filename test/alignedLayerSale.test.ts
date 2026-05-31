import { describe, expect, it } from "vitest";
import {
  classifyAlignedLayerSaleStatus,
  extractAlignedLayerSaleAssetUrls,
  extractAlignedLayerSaleValue
} from "../src/integrations/alignedLayerSale.js";

const html = `
  <!doctype html>
  <html>
    <head>
      <title>ALIGN | Token Sale</title>
      <script type="module" crossorigin src="/assets/index-B2HfV2Rd.js"></script>
      <link rel="stylesheet" crossorigin href="/assets/index-DOp58bqU.css">
    </head>
    <body>
      <div id="root"></div>
    </body>
  </html>
`;

describe("Aligned Layer sale parser", () => {
  it("extracts absolute app asset URLs from the HTML shell", () => {
    expect(extractAlignedLayerSaleAssetUrls(html)).toEqual([
      "https://sale.alignedlayer.com/assets/index-B2HfV2Rd.js",
      "https://sale.alignedlayer.com/assets/index-DOp58bqU.css"
    ]);
  });

  it("reports the current on-hold sale message from app bundle text", () => {
    const value = extractAlignedLayerSaleValue(
      html,
      [
        `xt.jsx("h2",{children:"THE SALE IS ON HOLD"}),xt.jsx("p",{children:"The sale is currently on hold pending further updates."})`
      ]
    );

    expect(value).toContain("Sale status: on hold");
    expect(value).toContain("Title: ALIGN | Token Sale");
    expect(value).toContain("THE SALE IS ON HOLD");
    expect(value).toContain("/assets/index-B2HfV2Rd.js");
  });

  it("changes the fingerprint when the app bundle status text changes", () => {
    const paused = extractAlignedLayerSaleValue(html, [`"THE SALE IS ON HOLD"`]);
    const resumed = extractAlignedLayerSaleValue(html, [`"The token sale is live and open"`]);

    expect(classifyAlignedLayerSaleStatus(resumed)).toBe("possibly resumed/open");
    expect(paused).not.toBe(resumed);
  });

  it("uses visible HTML text when there is no app-bundle status phrase", () => {
    const value = extractAlignedLayerSaleValue(`
      <html>
        <head><title>Aligned Sale</title></head>
        <body><main>Sale paused pending further updates.</main></body>
      </html>
    `);

    expect(value).toContain("Sale status: on hold");
    expect(value).toContain("Sale page text: Sale paused pending further updates.");
  });
});
