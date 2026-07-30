import { describe, expect, it } from "vitest";
import {
  extractAdditionalSolvedUrls,
  extractFrontierMathSolvedProblems,
  formatFrontierMathSolvedValue,
  frontierMathOpenProblemsAdapter
} from "../src/integrations/frontierMathOpenProblems.js";

const baselineHtml = `
  <div class="open-problem">
    <a class="cover-link" href="/frontiermath/open-problems/ramsey-hypergraphs"></a>
    <div class="open-problem-status solved">Solved</div>
    <div class="display-5"><p>A Ramsey-style Problem on Hypergraphs</p></div>
    <span class="notability-tag">Moderately interesting</span>
  </div>
  <div class="open-problem">
    <a class="cover-link" href="/frontiermath/open-problems/q2-absolute-galois"></a>
    <div class="open-problem-status solved">Solved</div>
    <div class="display-5"><p>The 2-adic Absolute Galois Group</p></div>
    <span class="notability-tag">Solid result</span>
  </div>
  <div class="open-problem">
    <a class="cover-link" href="/frontiermath/open-problems/hadamard-668"></a>
    <div class="open-problem-status unsolved">Unsolved</div>
    <div class="display-5"><p>Hadamard Matrices</p></div>
  </div>
`;

describe("FrontierMath Open Problems adapter", () => {
  it("extracts only Epoch cards explicitly marked solved", () => {
    expect(extractFrontierMathSolvedProblems(baselineHtml)).toEqual([
      {
        title: "A Ramsey-style Problem on Hypergraphs",
        url: "https://epoch.ai/frontiermath/open-problems/ramsey-hypergraphs",
        slug: "ramsey-hypergraphs",
        notability: "Moderately interesting"
      },
      {
        title: "The 2-adic Absolute Galois Group",
        url: "https://epoch.ai/frontiermath/open-problems/q2-absolute-galois",
        slug: "q2-absolute-galois",
        notability: "Solid result"
      }
    ]);
  });

  it("excludes the two issuance-baseline solved problems", () => {
    const value = formatFrontierMathSolvedValue(extractFrontierMathSolvedProblems(baselineHtml));
    expect(value).toContain("Qualifying additional solved: 0");
    expect(value).toContain("Status: No additional Epoch-confirmed solution");
    expect(extractAdditionalSolvedUrls(value)).toEqual([]);
  });

  it("alerts when Epoch marks an additional problem solved", () => {
    const previousValue = formatFrontierMathSolvedValue(extractFrontierMathSolvedProblems(baselineHtml));
    const currentHtml = baselineHtml.replace(
      '<div class="open-problem-status unsolved">Unsolved</div>',
      '<div class="open-problem-status solved">Solved</div>'
    );
    const currentValue = formatFrontierMathSolvedValue(extractFrontierMathSolvedProblems(currentHtml));

    expect(currentValue).toContain("Qualifying additional solved: 1");
    expect(currentValue).toContain("Hadamard Matrices");
    expect(extractAdditionalSolvedUrls(currentValue)).toEqual([
      "https://epoch.ai/frontiermath/open-problems/hadamard-668"
    ]);
    expect(frontierMathOpenProblemsAdapter.shouldAlertOnChange?.(previousValue, currentValue)).toBe(true);
    expect(frontierMathOpenProblemsAdapter.shouldAlertOnChange?.(currentValue, currentValue)).toBe(false);
  });

  it("fails visibly if Epoch's problem-card structure disappears", () => {
    expect(() => extractFrontierMathSolvedProblems("<html><body>No cards</body></html>")).toThrow(
      "Could not find Epoch AI FrontierMath open-problem cards"
    );
  });
});
