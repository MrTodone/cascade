/**
 * cascade-router/state/probe.ts — probe-кэш (hide/unhide, TTL).
 *
 * ЭТАП 1: контракт + in-memory (SPEC §5). Персист probe-cache и
 * hide-интеграция с каталогом/наборами — этап 2.
 * Собственный код.
 */
export interface ProbeResult {
  model: string;
  ok: boolean;
  latencyMs: number | null;
  status: number | null;
  at: number;
}

export interface ProbeCacheStats {
  entries: number;
  ok: number;
  broken: number;
  hidden: number;
}

export class ProbeCache {
  private results = new Map<string, ProbeResult>();
  private ttlMs: number;
  constructor(ttlMs = 24 * 60 * 60 * 1000) { this.ttlMs = ttlMs; }

  record(result: ProbeResult): void {
    this.results.set(result.model, result);
  }

  get(key: string): ProbeResult | null {
    const r = this.results.get(key);
    if (!r) return null;
    if (Date.now() - r.at > this.ttlMs) {
      this.results.delete(key);
      return null;
    }
    return r;
  }

  isBroken(key: string): boolean {
    const r = this.get(key);
    return Boolean(r && !r.ok);
  }

  shouldHide(key: string, autoHideBroken: boolean): boolean {
    return autoHideBroken && this.isBroken(key);
  }

  serialize(): Record<string, ProbeResult> {
    const out: Record<string, ProbeResult> = {};
    for (const [k, v] of this.results) out[k] = v;
    return out;
  }

  load(entries: Record<string, ProbeResult>): void {
    for (const [key, raw] of Object.entries(entries || {})) {
      if (!raw || !Number.isFinite(raw.at)) continue;
      this.results.set(key, raw);
    }
  }

  stats(): ProbeCacheStats {
    const all = [...this.results.values()];
    return {
      entries: all.length,
      ok: all.filter((r) => r.ok).length,
      broken: all.filter((r) => !r.ok).length,
      hidden: all.filter((r) => !r.ok).length,
    };
  }
}
