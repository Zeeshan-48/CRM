import { describe, expect, it } from "vitest";
import { fillJsonTemplate, fillPlain, getPath, getStringPath } from "../../src/utils/template";

describe("template fill", () => {
  it("fillPlain substitutes tokens verbatim", () => {
    expect(fillPlain("https://x/{{callId}}", { callId: "abc" })).toBe("https://x/abc");
    expect(fillPlain("Bearer {{apiKey}}", { apiKey: "k" })).toBe("Bearer k");
    expect(fillPlain("{{missing}}", {})).toBe("");
  });

  it("fillJsonTemplate escapes values for a JSON string context", () => {
    const out = fillJsonTemplate('{"name":"{{n}}"}', { n: 'a"b\nc' });
    expect(() => JSON.parse(out)).not.toThrow();
    expect(JSON.parse(out).name).toBe('a"b\nc');
  });
});

describe("getPath", () => {
  const obj = { a: { b: { c: 5 } }, list: [{ x: "one" }, { x: "two" }], s: "hi" };
  it("resolves dot and bracket paths", () => {
    expect(getPath(obj, "a.b.c")).toBe(5);
    expect(getPath(obj, "list[1].x")).toBe("two");
    expect(getPath(obj, "s")).toBe("hi");
  });
  it("returns undefined for missing paths", () => {
    expect(getPath(obj, "a.z")).toBeUndefined();
    expect(getPath(obj, "")).toBeUndefined();
    expect(getPath(null, "a")).toBeUndefined();
  });
  it("getStringPath stringifies non-strings", () => {
    expect(getStringPath(obj, "s")).toBe("hi");
    expect(getStringPath(obj, "a.b")).toBe('{"c":5}');
    expect(getStringPath(obj, "missing")).toBeNull();
  });
});
