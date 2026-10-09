/**
 * cascade-router/state/persist.ts — персист состояния ядра в ~/.cascade-router-dev/.
 *
 * Собственный код. Файлы: breakers.json, quota.json, probes.json, history.json.
 * Запись атомарная (tmp + rename), батчем по изменению (debounce), не на каждый тик.
 * Загрузка при старте; устойчивость к битому файлу (откат на пустое состояние).
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export class StatePersistence {
  private dir: string;
  private flushDelayMs: number;
  private dirty = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(dir: string, flushDelayMs = 2000) {
    this.dir = dir;
    this.flushDelayMs = flushDelayMs;
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  path(name: string): string {
    return join(this.dir, `${name}.json`);
  }

  read<T>(name: string, fallback: T): T {
    const p = this.path(name);
    if (!existsSync(p)) return fallback;
    try {
      return JSON.parse(readFileSync(p, "utf8")) as T;
    } catch {
      // Битый файл не должен ронять ядро: откат на пустое состояние.
      return fallback;
    }
  }

  /** Пометить файл изменённым; реальный сброс — по debounce (flush). */
  mark(name: string): void {
    this.dirty.add(name);
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, this.flushDelayMs);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Немедленная атомарная запись одного файла. */
  writeNow(name: string, data: unknown): void {
    const p = this.path(name);
    const tmp = `${p}.tmp-${process.pid}`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    renameSync(tmp, p);
  }

  /** Сбросить все помеченные файлы (вручную, например при shutdown). */
  flush(data: Record<string, unknown> = {}): void {
    for (const name of this.dirty) {
      if (name in data) this.writeNow(name, data[name]);
    }
    this.dirty.clear();
  }

  flushNow(data: Record<string, unknown>): void {
    for (const [name, value] of Object.entries(data)) this.writeNow(name, value);
    this.dirty.clear();
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  hasPending(): boolean {
    return this.dirty.size > 0;
  }
}

/** Лента попыток: модель, kind, мс, код — форма как у /stats старого ядра. */
export interface HistoryEntry {
  request_id: string;
  at: string;
  set: string | null;
  served_model: string | null;
  status: number | null;
  latency_ms: number;
  outcome: "served" | "all_failed" | "rejected";
  attempts: Array<{ model: string; status: number | null; latency_ms: number; kind: string }>;
  last_resort_used?: boolean;
}

export class HistoryLog {
  private entries: HistoryEntry[] = [];
  constructor(private limit = 200) {}

  append(entry: HistoryEntry): void {
    this.entries.unshift(entry);
    while (this.entries.length > this.limit) this.entries.pop();
  }

  recent(n = 20): HistoryEntry[] {
    return this.entries.slice(0, n);
  }

  all(): HistoryEntry[] {
    return [...this.entries];
  }

  stats(): { total: number; served: number; failed: number } {
    return {
      total: this.entries.length,
      served: this.entries.filter((e) => e.outcome === "served").length,
      failed: this.entries.filter((e) => e.outcome === "all_failed").length,
    };
  }

  load(entries: HistoryEntry[]): void {
    this.entries = Array.isArray(entries) ? entries.slice(0, this.limit) : [];
  }
}
