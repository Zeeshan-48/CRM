// Merge-field substitution for email templates. Templates are authored
// inconsistently, some use `{name}`, some `{{name}}`, `{{ first_name }}`,
// `{lead_name}`, etc., so we match all of those shapes case-insensitively.
// Used to show a WYSIWYG preview in the composer (the backend also substitutes
// {name}/{company} at send time, so sending already-filled text is a no-op).

export interface TemplateVars {
  name?: string | null;
  email?: string | null;
  company?: string | null;
}

export function fillTemplate(text: string, vars: TemplateVars): string {
  const name = (vars.name ?? "").trim();
  const firstName = name.split(/\s+/)[0] ?? "";
  const token = (key: string) => new RegExp(`\\{\\{?\\s*${key}\\s*\\}?\\}`, "gi");
  return text
    .replace(token("first[_ ]?name"), firstName)
    .replace(token("(?:full[_ ]?name|lead[_ ]?name|contact[_ ]?name|name)"), name)
    .replace(token("email"), vars.email ?? "")
    .replace(token("company"), vars.company ?? "");
}
