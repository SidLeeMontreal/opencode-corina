import { loadRubric } from "../../src/critique-rubric.js";

describe("critique rubric loader", () => {
  it("loads built-in corina rubric", () => {
    const rubric = loadRubric("corina");

    expect(rubric.id).toBe("corina");
    expect(rubric.name).toBe("Corina Editorial Standard");
  });

  it("unknown rubric name falls back to corina", () => {
    const rubric = loadRubric("does-not-exist");

    expect(rubric.id).toBe("corina");
  });

  it("rubric has correct dimensions", () => {
    const rubric = loadRubric("corina");

    expect(rubric.dimensions).toHaveLength(5);
    expect(rubric.dimensions.map((dimension) => dimension.id)).toEqual([
      "ai_patterns",
      "corina_tone",
      "precision",
      "evidence",
      "rhythm",
    ]);
  });
});
