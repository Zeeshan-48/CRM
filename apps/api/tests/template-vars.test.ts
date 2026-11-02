import { describe, expect, it } from "vitest";
import { fillTemplate, firstName } from "../src/utils/template-vars";

describe("firstName", () => {
  it("takes the first word and falls back to a neutral greeting", () => {
    expect(firstName("Suvesh Pandey")).toBe("Suvesh");
    expect(firstName("Asha")).toBe("Asha");
    expect(firstName("")).toBe("there");
    expect(firstName(null)).toBe("there");
    expect(firstName(undefined)).toBe("there");
  });
});

describe("fillTemplate", () => {
  it("substitutes every occurrence of {name}", () => {
    const out = fillTemplate("Hi {name}, thanks {name}!", { name: "Asha Rao" });
    expect(out).toBe("Hi Asha, thanks Asha!");
  });

  it("substitutes {company} and renders it empty when absent", () => {
    expect(fillTemplate("At {company}.", { company: "Acme" })).toBe("At Acme.");
    expect(fillTemplate("At {company}.", { company: null })).toBe("At .");
    expect(fillTemplate("At {company}.", {})).toBe("At .");
  });

  it("never leaves a raw token behind", () => {
    const out = fillTemplate("Hi {name}, from {company}", {});
    expect(out).not.toContain("{name}");
    expect(out).not.toContain("{company}");
    expect(out).toBe("Hi there, from ");
  });

  it("leaves text without tokens untouched", () => {
    expect(fillTemplate("No tokens here.", { name: "Asha" })).toBe("No tokens here.");
  });

  it("does not touch unknown tokens", () => {
    expect(fillTemplate("Hi {name}, {unknown}", { name: "Asha" })).toBe("Hi Asha, {unknown}");
  });
});
