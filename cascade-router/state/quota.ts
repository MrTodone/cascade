/**
 * cascade-router/state/quota.ts — реестр quota-пауз.
 *
 * Собственный код, поведение CORE-SPEC §6: пауза = now + pauseMs
 * (DEFAULT 60000 или Retry-After с cap 15 мин), авто-истечение при чтении,
 * снятие на успехе. Персист/endpoint-fetchers — этап 2.
 */
export const DEFAULT_QUOTA_PAUSE_MS = 60000;
export const MAX_PAUSE_MS = 15 * 60 * 1000;

export interface QuotaPause {
  model: string;
  until: number;
  retry_after_ms: number;
  status: number | null;
  last_seen: string;
}

export class QuotaRegistry {
  private pauses = new Map<string, QuotaPause>();

  active(key: string): boolean {
    const p = this.pauses.get(key);
    if (!p) return false;
    if (Date.now() >= p.until) {
      this.pauses.delete(key);
      return false;
    }
    return true;
  }

  record(key: string, pauseMs: number, status: number | null): QuotaPause {
    const ms = Math.min(Math.max(pauseMs, 0), MAX_PAUSE_MS) || DEFAULT_QUOTA_PAUSE_MS;
    const pause: QuotaPause = {
      model: key, until: Date.now() + ms, retry_after_ms: ms, status,
      last_seen: new Date().toISOString(),
    };
    this.pauses.set(key, pause);
    return pause;
  }

  clear(key: string): void {
    this.pauses.delete(key);
  }

  serialize(): Record<string, QuotaPause> {
    const out: Record<string, QuotaPause> = {};
    for (const [k, v] of this.pauses) out[k] = v;
    return out;
  }

  load(entries: Record<string, QuotaPause>): void {
    for (const [key, raw] of Object.entries(entries || {})) {
      if (!raw || !Number.isFinite(raw.until)) continue;
      this.pauses.set(key, { ...raw });
    }
  }

  all(): QuotaPause[] {
    for (const key of [...this.pauses.keys()]) this.active(key); // чистим истёкшие
    return [...this.pauses.values()];
  }
}
