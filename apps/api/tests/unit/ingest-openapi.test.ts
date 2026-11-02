import { describe, expect, it } from "vitest";
import ingestRouter from "../../src/routes/ingest.route";
import { INGEST_OPENAPI } from "../../src/services/ingest-openapi";

/**
 * Keeps the published contract honest.
 *
 * The spec is hand-authored (the request bodies are deliberately permissive, so
 * generating from the zod schemas would document "array of unknown" and help
 * nobody). Hand-authored means it can drift, and a wrong integration spec costs
 * an integrating team more time than no spec at all, they build against it, ship,
 * and only then discover the endpoint never existed.
 *
 * So this asserts the two directions of drift that actually hurt:
 *   1. the spec describes an endpoint the router does not serve (an integrator
 *      builds against a 404), and
 *   2. the router serves a public endpoint the spec never mentions (an integrator
 *      cannot discover it and asks us instead).
 */

interface RouteLayer {
  route?: { path?: string; methods?: Record<string, boolean> };
}

// Express keeps one layer per registered route; `methods` is a map like
// { post: true }. Normalised to "METHOD path" for set comparison.
const routerOperations = (): Set<string> => {
  const ops = new Set<string>();
  for (const layer of (ingestRouter as unknown as { stack: RouteLayer[] }).stack) {
    const path = layer.route?.path;
    if (!path) continue;
    for (const [method, enabled] of Object.entries(layer.route?.methods ?? {})) {
      // Express registers HEAD alongside every GET; the spec only documents GET.
      if (enabled && method !== "head") ops.add(`${method.toUpperCase()} ${path}`);
    }
  }
  return ops;
};

// The spec uses OpenAPI templating (`/leads/t/{token}`); Express uses `:token`.
const specOperations = (): Set<string> => {
  const ops = new Set<string>();
  for (const [path, methods] of Object.entries(INGEST_OPENAPI.paths)) {
    const expressPath = path.replace(/\{([^}]+)\}/g, ":$1");
    for (const method of Object.keys(methods)) {
      ops.add(`${method.toUpperCase()} ${expressPath}`);
    }
  }
  return ops;
};

describe("ingest OpenAPI spec", () => {
  it("documents every endpoint the router serves", () => {
    const undocumented = [...routerOperations()].filter((op) => !specOperations().has(op));
    expect(undocumented).toEqual([]);
  });

  it("describes no endpoint the router does not serve", () => {
    const phantom = [...specOperations()].filter((op) => !routerOperations().has(op));
    expect(phantom).toEqual([]);
  });

  it("is a valid OpenAPI 3.1 document with the pieces a generator needs", () => {
    expect(INGEST_OPENAPI.openapi).toBe("3.1.0");
    expect(INGEST_OPENAPI.info.title).toBeTruthy();
    expect(INGEST_OPENAPI.info.version).toBeTruthy();
    expect(INGEST_OPENAPI.servers.length).toBeGreaterThan(0);
    expect(Object.keys(INGEST_OPENAPI.paths).length).toBeGreaterThan(0);
  });

  it("resolves every internal $ref", () => {
    // A dangling $ref makes most client generators fail outright, and it is the
    // easiest thing to break when adding a response by copy-paste.
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (!node || typeof node !== "object") return;
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        if (key === "$ref" && typeof value === "string") refs.push(value);
        else walk(value);
      }
    };
    walk(INGEST_OPENAPI);
    expect(refs.length).toBeGreaterThan(0);

    const resolve = (ref: string): unknown => {
      expect(ref.startsWith("#/")).toBe(true);
      let cursor: unknown = INGEST_OPENAPI;
      for (const segment of ref.slice(2).split("/")) {
        cursor = (cursor as Record<string, unknown> | undefined)?.[segment];
      }
      return cursor;
    };
    for (const ref of refs) expect(resolve(ref), `unresolved $ref ${ref}`).toBeTruthy();
  });

  it("marks the two browser-safe endpoints, and only those, as publishable-key usable", () => {
    // A publishable key ships in page source. If the spec ever advertised it on a
    // catalog write, an integrator would wire prices up from the browser and hand
    // anyone who viewed source the ability to rewrite them.
    const publishable = new Set<string>();
    for (const [path, methods] of Object.entries(INGEST_OPENAPI.paths)) {
      for (const [method, op] of Object.entries(methods)) {
        const security = (op as { security?: Array<Record<string, unknown>> }).security;
        if (security?.some((s) => "PublishableKey" in s)) {
          publishable.add(`${method.toUpperCase()} ${path}`);
        }
      }
    }
    expect(publishable).toEqual(new Set(["POST /identify", "POST /events"]));
  });
});
