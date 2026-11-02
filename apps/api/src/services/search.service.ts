import { BadRequestError } from "../errors";
import searchRepository from "../repositories/search.repository";

export interface SearchResultItem {
  id: string;
  title: string;
  sub: string;
  route: string;
}

export interface SearchGroup {
  type: string;
  items: SearchResultItem[];
}

class SearchService {
  async search(tenantId: string, rawQuery: unknown): Promise<SearchGroup[]> {
    const q = String(rawQuery ?? "").trim();
    if (q.length < 2) throw new BadRequestError("q must be at least 2 characters");

    const { leads, contacts, accounts, deals, tickets } = await searchRepository.search(
      tenantId,
      q
    );

    return [
      {
        type: "lead",
        items: leads.map((l) => ({
          id: l.id,
          title: l.name,
          sub: [l.city, l.source].filter(Boolean).join(" · "),
          route: "leads",
        })),
      },
      {
        type: "contact",
        items: contacts.map((c) => ({
          id: c.id,
          title: c.name,
          sub: c.company || c.email || "",
          route: "contacts",
        })),
      },
      {
        type: "account",
        items: accounts.map((a) => ({
          id: a.id,
          title: a.name,
          sub: a.industry || "",
          route: "accounts",
        })),
      },
      {
        type: "deal",
        items: deals.map((d) => ({
          id: d.id,
          title: d.title,
          sub: "₹" + Number(d.value ?? 0).toLocaleString("en-IN"),
          route: "pipeline",
        })),
      },
      {
        type: "ticket",
        items: tickets.map((t) => ({
          id: t.id,
          title: t.subject,
          sub: t.status || "",
          route: "tickets",
        })),
      },
    ];
  }
}

export default new SearchService();
