/**
 * cascade-router/catalog.ts — нативный каталог моделей.
 *
 * Собственный код. Каталог НЕ поднимается из sources.js старого пакета:
 * его собирает scripts/catalog-bootstrap.mjs из живых API провайдеров +
 * верифицированных данных задач 4/15 (см. provenance в catalog.json).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { CatalogEntry } from "./types.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = process.env.CASCADE_ROUTER_CATALOG || join(HERE, "catalog.json");

export class Catalog {
  private byKey = new Map<string, CatalogEntry>();
  readonly loadedFrom: string;
  readonly count: number;

  constructor(path: string = CATALOG_PATH) {
    this.loadedFrom = path;
    if (!existsSync(path)) {
      this.count = 0;
      return;
    }
    const raw = JSON.parse(readFileSync(path, "utf8"));
    for (const entry of (raw.models || []) as CatalogEntry[]) {
      if (!entry?.provider || !entry?.model) continue;
      this.byKey.set(`${entry.provider}/${entry.model}`, entry);
    }
    this.count = this.byKey.size;
  }

  get(provider: string, model: string): CatalogEntry | null {
    return this.byKey.get(`${provider}/${model}`) || null;
  }

  has(provider: string, model: string): boolean {
    return this.byKey.has(`${provider}/${model}`);
  }

  all(): CatalogEntry[] {
    return [...this.byKey.values()];
  }

  providers(): string[] {
    return [...new Set(this.all().map((e) => e.provider))];
  }
}
