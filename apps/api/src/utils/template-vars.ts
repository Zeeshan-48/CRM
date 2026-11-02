// Merge-field substitution for outbound message templates.
//
// Templates are authored with `{name}` / `{company}` tokens. Every send path
// must resolve them before handing the text to a provider, an unresolved
// `Hi {name},` reaching a real inbox is the visible failure mode.

export const firstName = (name?: string | null): string => (name || "there").split(" ")[0];

export interface TemplateVars {
  /** The recipient's full name; `{name}` renders its first word. */
  name?: string | null;
  /** Contacts only, leads have no company, so `{company}` renders empty. */
  company?: string | null;
}

/** Replaces every `{name}` / `{company}` token. Safe on text with no tokens. */
export const fillTemplate = (text: string, vars: TemplateVars): string =>
  text.replace(/\{name\}/g, firstName(vars.name)).replace(/\{company\}/g, vars.company ?? "");
