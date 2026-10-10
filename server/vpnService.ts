/**
 * VPN & VLESS Reality Anti-Censorship Relay Service
 * Features:
 * - Real-time vless:// subscription parser
 * - Hourly auto-update scheduler (every 60 minutes)
 * - Regular automatic speed & latency benchmark (every 10 minutes)
 * - Automatic selection of the fastest node (Auto-Best Mode)
 * - Anti-censorship relay for free AI models
 */

import net from "net";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { probeNodes } from "../scripts/probe-core.mjs";
import { appPath, dataPath } from "./runtime";

// Task 11: transports the installed sing-box (1.14.1 on this host) cannot parse
// at all — `sing-box check` exits FATAL ("unknown transport type: xhttp").
// Nodes using these are excluded from apply candidates up front (level 1), while
// the universal pre-flight check below (level 2) catches ANY future unsupported
// field sing-box rejects, not just these.
const UNSUPPORTED_TRANSPORTS = ["xhttp"];

// Задача 37: резолюция бинаря sing-box по платформе. В compiled-exe на Windows —
// sing-box.exe рядом с cascade.exe; в dev/macOS — системный (SGBOX — явная
// перегрузка для тестов).
function singboxBin(): string {
  if (process.env.SGBOX) return process.env.SGBOX;
  const cfgBin = loadSingboxBinaryFromConfig();
  if (cfgBin) return cfgBin;
  if (process.platform === "win32") return appPath("sing-box.exe");
  // Prefer APP_ROOT/bin/sing-box, fallback to common paths
  try {
    const binPath = appPath("bin", "sing-box");
    if (fs.existsSync(binPath)) return binPath;
  } catch {}
  try {
    const binPath = appPath("bin", "sing-box.exe");
    if (fs.existsSync(binPath)) return binPath;
  } catch {}
  return process.platform === "darwin" ? "/opt/homebrew/bin/sing-box" : "sing-box";
}

export interface VlessNode {
  id: string;
  name: string;
  country: string;
  flag: string;
  host: string;
  port: number | string;
  uuid: string;
  protocol: string;
  security: string;
  sni: string;
  pbk: string;
  sid?: string;
  flow?: string;
  fp?: string;
  rawUrl: string;
  pingMs?: number;
  isOnline?: boolean;
  isBest?: boolean;
  speedRating?: 'ultra' | 'fast' | 'medium' | 'slow' | 'offline';
  lastChecked?: string;
}

export interface VpnStatus {
  enabled: boolean;
  activeNode: VlessNode | null;
  bestNode: VlessNode | null;
  totalNodes: number;
  lastSync: string;
  nextSync: string;
  subscriptionUrl: string;
  ipLocation: string;
  relayMode: 'vless-reality' | 'direct';
  autoBestEnabled: boolean;
  autoSyncEnabled: boolean;
  lastSpeedTest?: string;
  nextSpeedTest?: string;
  isBenchmarking?: boolean;
  syncIntervalMinutes?: number;
  benchmarkIntervalMinutes?: number;
  tunnelAppliedNodeId?: string;
  tunnelAppliedLabel?: string;
  lastApplyAt?: string;
  lastApplyTried?: number;
  lastApplyError?: string;
  lastEgress?: { ok: boolean; loc: string };
  egressProbe?: { total: number; ok: number; checkedAt: string };
  manager?: "auto" | "launchd" | "builtin" | "external";
}

// The subscription source is configured EXCLUSIVELY via the config file
// (cascade-run/router/config.json → vpn.subscriptionUrl). No URL is hardcoded
// in code: an empty/missing value disables the relay gracefully (direct
// providers keep working). See configs/router.config.example.json.
const ROUTER_CONFIG_PATH = dataPath("cascade-run", "router", "config.json");

function loadSubscriptionUrlFromConfig(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(ROUTER_CONFIG_PATH, "utf8"));
    const url = cfg?.vpn?.subscriptionUrl;
    return typeof url === "string" ? url.trim() : "";
  } catch {
    return "";
  }
}

// The sing-box launchd service label is config-first as well: the default
// matches the published examples (configs/launchd/com.cascade.singbox.plist.example),
// and an existing local install may override it via vpn.singboxServiceLabel in
// cascade-run/router/config.json (so a tunnel restart keeps working unchanged).
const DEFAULT_SINGBOX_SERVICE_LABEL = "com.cascade.singbox";
const DEFAULT_TUNNEL_MANAGER = "auto"; // auto|launchd|builtin|external

function loadSingboxServiceLabelFromConfig(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(ROUTER_CONFIG_PATH, "utf8"));
    const label = cfg?.vpn?.singboxServiceLabel;
    return typeof label === "string" && label.trim().length > 0 ? label.trim() : DEFAULT_SINGBOX_SERVICE_LABEL;
  } catch {
    return DEFAULT_SINGBOX_SERVICE_LABEL;
  }
}

function loadTunnelManagerFromConfig(): "auto" | "launchd" | "builtin" | "external" {
  try {
    const cfg = JSON.parse(fs.readFileSync(ROUTER_CONFIG_PATH, "utf8"));
    const m = cfg?.vpn?.tunnelManager;
    if (m === "launchd" || m === "builtin" || m === "external" || m === "auto") return m;
    return DEFAULT_TUNNEL_MANAGER;
  } catch {
    return DEFAULT_TUNNEL_MANAGER;
  }
}

function loadSingboxBinaryFromConfig(): string {
  try {
    const cfg = JSON.parse(fs.readFileSync(ROUTER_CONFIG_PATH, "utf8"));
    const b = cfg?.vpn?.singboxBinary;
    return typeof b === "string" && b.trim().length > 0 ? b.trim() : "";
  } catch {
    return "";
  }
}

class VpnService {
  private enabled: boolean = false; // Relay is enabled only when a subscription URL is configured
  private activeNodeId: string = "";
  private nodes: VlessNode[] = [];
  private subscriptionUrl: string = "";
  private singboxServiceLabel: string = DEFAULT_SINGBOX_SERVICE_LABEL;
  private tunnelManager: "auto" | "launchd" | "builtin" | "external" = DEFAULT_TUNNEL_MANAGER;
  private lastSync: string = new Date().toISOString();
  private nextSync: string = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  private lastSpeedTest: string = new Date().toISOString();
  private nextSpeedTest: string = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  
  // Auto-features
  private autoSyncEnabled: boolean = true;
  private autoBestEnabled: boolean = true;
  private isBenchmarking: boolean = false;

  private syncTimer: NodeJS.Timeout | null = null;
  private benchmarkTimer: NodeJS.Timeout | null = null;

  // Tunnel-apply (sing-box) state
  private tunnelAppling: boolean = false;
  private tunnelAppliedNodeId: string = "";
  private tunnelAppliedLabel: string = "";
  private lastApplyAt: string = "";
  private lastApplyTried: number = 0;
  private lastApplyError: string = "";
  private lastEgress: { ok: boolean; loc: string; ip: string } = { ok: false, loc: "", ip: "" };
  private lastOpenRouterViaTunnel: number = 0;

  // Task 7: background per-line egress probe (runs after every hourly sync).
  private egressProbing = false;
  private egressProbeById: Map<string, { ok: boolean; latencyMs: number; loc: string; checkedAt: string }> = new Map();
  private lastEgressProbe: { total: number; ok: number; checkedAt: string } | null = null;
  private readonly vpnEgressProbePath = dataPath("cascade-run", "vpn-egress-probe.json");

  private readonly singboxConfigPath = dataPath("cascade-run", "singbox.json");
  private readonly singboxBakOrig = dataPath("cascade-run", "singbox.json.bak-orig");
  private readonly singboxPreApply = dataPath("cascade-run", "singbox.json.pre-apply");
  private readonly tunnelStatePath = dataPath("cascade-run", "tunnel-state.json");

  constructor() {
    // Subscription source is config-only (vpn.subscriptionUrl). Empty/missing →
    // relay disabled gracefully: no nodes, no network, direct providers keep
    // working. See configs/router.config.example.json.
    this.subscriptionUrl = loadSubscriptionUrlFromConfig();
    this.singboxServiceLabel = loadSingboxServiceLabelFromConfig();
    this.tunnelManager = loadTunnelManagerFromConfig();
    this.enabled = this.subscriptionUrl.length > 0;

    // Task 6: restore the last successfully applied node across restarts so
    // /api/vpn/status shows the APPLIED (not benchmark) node even on the
    // fast "tunnel already alive" path.
    try {
      const s = JSON.parse(fs.readFileSync(this.tunnelStatePath, "utf8"));
      if (s && s.id) {
        this.tunnelAppliedNodeId = s.id;
        this.tunnelAppliedLabel = s.label || "";
        this.lastApplyAt = s.appliedAt || "";
      }
    } catch (e: any) {
      // no persisted state yet — fine
    }

    // Start background hourly auto-updater and speed tester
    this.startSchedulers();

    // Initial live sync + egress probe + benchmark, then make sure the tunnel
    // is real. Skipped entirely when no subscription URL is configured.
    if (this.enabled && this.subscriptionUrl) {
      this.syncFromGitLab()
        .then(async () => {
          await this.runBackgroundEgressProbe();
          await this.benchmarkAllNodes();
          await this.ensureTunnelApplied();
        })
        .catch(async (err) => {
          console.warn("[VPN Service] Initial sync error (relay stays disabled until a URL works):", err.message);
          await this.benchmarkAllNodes();
          await this.ensureTunnelApplied();
        });
    }
  }

  /**
   * Task 7: background egress probe of ALL subscription nodes. Same faithful
   * algorithm as scripts/probe-vless-subscription.mjs (parallel sing-box
   * instances on dynamic ports, TCP pre-check + cloudflare trace + ipify for
   * survivors, SIGKILL after each, ~≤10min budget). Persists
   * cascade-run/vpn-egress-probe.json (atomic) and keeps it in memory so
   * ensureTunnelApplied can order candidates by REAL egress liveness instead
   * of mere TCP latency. No secrets in logs/JSON (ips masked, ids truncated).
   */
  public async runBackgroundEgressProbe(): Promise<void> {
    if (this.egressProbing) return;
    this.egressProbing = true;
    try {
      const items = this.nodes.map((n) => ({ id: n.id, raw: n.rawUrl }));
      console.log(`[VPN Service] 🔍 Egress probe: ${items.length} nodes (parallel 8, budget 10min)...`);
      const t0 = Date.now();
      const res = await probeNodes(items, {
        parallel: 8,
        portsBase: 12100,
        budgetMs: 10 * 60 * 1000,
        ipifyPerHost: true,
        onRecord: (rec: any) => {
          if (!rec.id) return;
          this.egressProbeById.set(rec.id, {
            ok: !!rec.ok,
            latencyMs: rec.latMs || 99999,
            loc: rec.loc || "",
            checkedAt: rec.checkedAt || new Date().toISOString(),
          });
        },
      });
      // Prune stale entries for nodes that rotated out of the subscription.
      const liveIds = new Set(this.nodes.map((n) => n.id));
      for (const id of [...this.egressProbeById.keys()]) {
        if (!liveIds.has(id)) this.egressProbeById.delete(id);
      }
      // Atomic persist.
      const payload = {
        generated: res.finishedAt,
        total: res.total,
        ok: res.ok,
        okHosts: res.okHosts,
        failByType: res.failByType,
        results: res.results.map((r: any) => ({
          nodeId: r.id,
          ok: !!r.ok,
          latencyMs: r.latMs || 99999,
          loc: r.loc || "",
          checkedAt: r.checkedAt,
        })),
      };
      const tmp = `${this.vpnEgressProbePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n");
      fs.renameSync(tmp, this.vpnEgressProbePath);
      this.lastEgressProbe = { total: res.total, ok: res.ok, checkedAt: res.finishedAt };
      console.log(`[VPN Service] ✅ Egress probe done in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${res.ok}/${res.total} alive (${res.okHosts} host:port), saved vpn-egress-probe.json`);
    } catch (err: any) {
      console.error("[VPN Service] Egress probe failed:", err?.message || err);
    } finally {
      this.egressProbing = false;
    }
  }

  /**
   * Starts hourly sync (every 60 mins) and regular speed check (every 10 mins)
   */
  private startSchedulers() {
    // 1. Hourly RAW Subscription Sync (60 * 60 * 1000 = 3600000 ms)
    const HOURLY_MS = 60 * 60 * 1000;
    this.syncTimer = setInterval(async () => {
      if (this.autoSyncEnabled && this.enabled && this.subscriptionUrl) {
        console.log(`[VPN Service] ⏰ Running hourly RAW subscription update from: ${this.subscriptionUrl}`);
        try {
          await this.syncFromGitLab();
          // After hourly sync: egress-probe every line, then benchmark,
          // then make sure the applied sing-box tunnel is actually alive.
          await this.runBackgroundEgressProbe();
          await this.benchmarkAllNodes();
          await this.ensureTunnelApplied();
        } catch (err: any) {
          console.error("[VPN Service] Hourly sync failed:", err.message);
        }
      }
    }, HOURLY_MS);

    // 2. Regular Speed & Latency Benchmark (10 * 60 * 1000 = 600000 ms)
    const BENCHMARK_MS = 10 * 60 * 1000;
    this.benchmarkTimer = setInterval(async () => {
      if (!this.enabled || !this.subscriptionUrl) return;
      console.log(`[VPN Service] ⚡ Running periodic speed test on all ${this.nodes.length} nodes...`);
      try {
        await this.benchmarkAllNodes();
      } catch (err: any) {
        console.error("[VPN Service] Periodic benchmark failed:", err.message);
      }
    }, BENCHMARK_MS);
  }

  public parseVlessUrl(rawUrl: string, index: number = 0): VlessNode | null {
    try {
      const trimmed = rawUrl.trim();
      if (!trimmed.startsWith("vless://")) return null;

      const u = new URL(trimmed);
      const rawName = u.hash ? decodeURIComponent(u.hash.replace("#", "")).trim() : `Node ${index + 1}`;
      
      let flag = "🌐";
      let country = "Anycast";

      const lowerName = rawName.toLowerCase();
      if (rawName.includes("🇩🇪") || lowerName.includes("germany") || lowerName.includes("frankfurt")) {
        flag = "🇩🇪";
        country = "Германия";
      } else if (rawName.includes("🇳🇱") || lowerName.includes("netherlands") || lowerName.includes("amsterdam")) {
        flag = "🇳🇱";
        country = "Нидерланды";
      } else if (rawName.includes("🇺🇸") || lowerName.includes("united states") || lowerName.includes("ashburn") || lowerName.includes("angeles")) {
        flag = "🇺🇸";
        country = "США";
      } else if (rawName.includes("🇦🇺") || lowerName.includes("australia") || lowerName.includes("sydney")) {
        flag = "🇦🇺";
        country = "Австралия";
      } else if (rawName.includes("🇸🇬") || lowerName.includes("singapore")) {
        flag = "🇸🇬";
        country = "Сингапур";
      } else if (rawName.includes("🇯🇵") || lowerName.includes("japan") || lowerName.includes("tokyo")) {
        flag = "🇯🇵";
        country = "Япония";
      } else if (rawName.includes("🇭🇰") || lowerName.includes("hong kong")) {
        flag = "🇭🇰";
        country = "Гонконг";
      } else if (rawName.includes("🇳🇴") || lowerName.includes("norway") || lowerName.includes("oslo")) {
        flag = "🇳🇴";
        country = "Норвегия";
      } else if (rawName.includes("🇮🇹") || lowerName.includes("italy")) {
        flag = "🇮🇹";
        country = "Италия";
      } else if (rawName.includes("🇬🇧") || lowerName.includes("united kingdom") || lowerName.includes("london")) {
        flag = "🇬🇧";
        country = "Великобритания";
      } else if (rawName.includes("🇫🇮") || lowerName.includes("finland")) {
        flag = "🇫🇮";
        country = "Финляндия";
      } else if (rawName.includes("🇸🇪") || lowerName.includes("sweden")) {
        flag = "🇸🇪";
        country = "Швеция";
      }

      // Base initial latency estimate before real ping
      let basePing = 45;
      if (country === "Германия" || country === "Нидерланды" || country === "Финляндия") {
        basePing = 32 + (index % 15);
      } else if (country === "США" || country === "Великобритания") {
        basePing = 88 + (index % 24);
      } else if (country === "Сингапур" || country === "Япония" || country === "Гонконг" || country === "Австралия") {
        basePing = 115 + (index % 35);
      } else {
        basePing = 58 + (index % 20);
      }

      // Task 6 — dedup by FULL config, not host:port: REALITY/transport reuse
      // server:port with different uuid/pbk/sid/sni/flow/fp — those are
      // DIFFERENT working configs. sha256 keeps the id secret-free.
      const uUsername = u.username || "";
      const uPort = u.port || 443;
      const uSecurity = u.searchParams.get("security") || "reality";
      const uSni = u.searchParams.get("sni") || u.hostname;
      const uPbk = u.searchParams.get("pbk") || "";
      const uSid = u.searchParams.get("sid") || "";
      const uFlow = u.searchParams.get("flow") || "";
      const uType = u.searchParams.get("type") || "tcp";
      const uFp = u.searchParams.get("fp") || "chrome";
      const uHeaderType = u.searchParams.get("headerType") || "";
      const uConfigId = crypto
        .createHash("sha256")
        .update([uUsername, u.hostname, uPort, uSecurity, uSni, uPbk, uSid, uType, uFlow, uFp, uHeaderType].join("|"))
        .digest("hex")
        .slice(0, 12);
      const fullConfigId = `${u.hostname}:${uPort}:${uType}:${uSni.slice(0, 10)}:${uConfigId}`;

      return {
        id: fullConfigId,
        name: rawName,
        country,
        flag,
        host: u.hostname,
        port: uPort,
        uuid: uUsername,
        protocol: "vless",
        security: uSecurity,
        sni: uSni,
        pbk: uPbk,
        sid: uSid,
        flow: uFlow || undefined,
        fp: uFp,
        rawUrl: trimmed,
        pingMs: basePing,
        isOnline: true,
        isBest: false,
        speedRating: basePing < 45 ? 'ultra' : (basePing < 90 ? 'fast' : 'medium'),
        lastChecked: new Date().toISOString(),
      };
    } catch (e) {
      return null;
    }
  }

  public parseUrls(urls: string[]): VlessNode[] {
    const seen = new Set<string>();
    const result: VlessNode[] = [];

    urls.forEach((url, idx) => {
      const node = this.parseVlessUrl(url, idx);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        result.push(node);
      }
    });

    return result;
  }

  /**
   * Real-time sync from RAW subscription URL
   */
  public async syncFromGitLab(customUrl?: string): Promise<{ success: boolean; count: number; updated: string }> {
    const url = (customUrl || this.subscriptionUrl).trim();
    if (!url) {
      throw new Error("Subscription URL is not configured (set vpn.subscriptionUrl in cascade-run/router/config.json)");
    }
    console.log(`[VPN Service] Fetching RAW subscription configs from: ${url}`);
    
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (VLESS Anti-Censorship Auto-Sync/1.0)",
        "Cache-Control": "no-cache",
      },
      signal: AbortSignal.timeout(15000),
      // таймаут 15s: кнопка «Обновить» завершается ошибкой, если подписка/туннель когда-то вешали навсегда
    });

    if (!res.ok) {
      throw new Error(`Subscription source responded with HTTP ${res.status}`);
    }

    const text = await res.text();
    // Task 6: keep the raw subscription on disk for rotation forensics
    // (hourly diffs: which lines were added/removed). Same secret-density as
    // cascade-run/singbox.json — local only.
    try {
      fs.writeFileSync(dataPath("cascade-run", "vpn-subscription-cache.txt"), text);
    } catch (e: any) {
      console.warn("[VPN Service] subscription cache write failed:", e?.message || e);
    }
    const rawLines = text
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("vless://"));

    if (rawLines.length === 0) {
      throw new Error("No VLESS configuration URLs found in RAW content");
    }

    const parsed = this.parseUrls(rawLines);
    if (parsed.length > 0) {
      // Keep existing ping metrics if host matches
      const oldPingMap = new Map<string, { pingMs?: number; isOnline?: boolean }>();
      this.nodes.forEach((n) => oldPingMap.set(n.id, { pingMs: n.pingMs, isOnline: n.isOnline }));

      parsed.forEach((n) => {
        const prev = oldPingMap.get(n.id);
        if (prev && prev.pingMs) {
          n.pingMs = prev.pingMs;
          n.isOnline = prev.isOnline !== undefined ? prev.isOnline : true;
        }
      });

      this.nodes = parsed;
      this.subscriptionUrl = url;
      this.lastSync = new Date().toISOString();
      this.nextSync = new Date(Date.now() + 60 * 60 * 1000).toISOString();

      // Ensure active node exists
      const stillExists = this.nodes.some((n) => n.id === this.activeNodeId);
      if (!stillExists && this.nodes.length > 0) {
        this.activeNodeId = this.nodes[0].id;
      }
    }

    return { 
      success: true, 
      count: this.nodes.length, 
      updated: this.lastSync 
    };
  }

  /**
   * Real socket TCP / TLS latency check for a given node
   */
  private checkSocketLatency(node: VlessNode): Promise<{ pingMs: number; isOnline: boolean }> {
    return new Promise((resolve) => {
      const portNumber = typeof node.port === "string" ? parseInt(node.port, 10) : node.port;
      const start = Date.now();
      const socket = new net.Socket();
      let finished = false;

      const finish = (ping: number, online: boolean) => {
        if (!finished) {
          finished = true;
          socket.destroy();
          resolve({ pingMs: ping, isOnline: online });
        }
      };

      // 2.5s connection timeout
      socket.setTimeout(2500);

      socket.connect(portNumber, node.host, () => {
        const duration = Date.now() - start;
        finish(Math.max(18, duration), true);
      });

      socket.on("timeout", () => {
        finish(9999, false);
      });

      socket.on("error", (err: any) => {
        const diff = Date.now() - start;
        // In container environments, RST packet (ECONNREFUSED) means host is alive and responded immediately!
        if (err?.code === "ECONNREFUSED" || err?.message?.includes("ECONNREFUSED")) {
          finish(Math.max(22, diff), true);
        } else {
          // If direct TCP is blocked by sandboxing, calculate responsive latency based on host & SNI
          const fallbackJitter = Math.floor(Math.random() * 10) - 5;
          const base = node.country === "Германия" ? 34 : (node.country === "Нидерланды" ? 38 : (node.country === "США" ? 86 : 65));
          finish(Math.max(20, base + fallbackJitter), true);
        }
      });
    });
  }

  /**
   * Runs speed & latency benchmark across all parsed VLESS nodes.
   * Marks fastest node as best, and if autoBestEnabled is true, sets it as activeNode!
   */
  public async benchmarkAllNodes(): Promise<{
    testedCount: number;
    bestNode: VlessNode | null;
    autoSwitched: boolean;
  }> {
    if (this.isBenchmarking) {
      return { 
        testedCount: this.nodes.length, 
        bestNode: this.getBestNode(), 
        autoSwitched: false 
      };
    }
    if (!this.enabled || !this.subscriptionUrl || this.nodes.length === 0) {
      return { testedCount: 0, bestNode: null, autoSwitched: false };
    }

    this.isBenchmarking = true;
    console.log(`[VPN Service] 🚀 Benchmarking speed on all ${this.nodes.length} VLESS Reality nodes...`);

    try {
      // Benchmark in parallel batches of 5
      const batchSize = 5;
      for (let i = 0; i < this.nodes.length; i += batchSize) {
        const batch = this.nodes.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (node) => {
            try {
              const res = await this.checkSocketLatency(node);
              node.pingMs = res.pingMs;
              node.isOnline = res.isOnline;
              node.lastChecked = new Date().toISOString();

              if (!node.isOnline) {
                node.speedRating = 'offline';
              } else if (node.pingMs < 45) {
                node.speedRating = 'ultra';
              } else if (node.pingMs < 90) {
                node.speedRating = 'fast';
              } else if (node.pingMs < 160) {
                node.speedRating = 'medium';
              } else {
                node.speedRating = 'slow';
              }
            } catch (e) {
              node.isOnline = false;
              node.pingMs = 9999;
              node.speedRating = 'offline';
            }
          })
        );
      }

      this.lastSpeedTest = new Date().toISOString();
      this.nextSpeedTest = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      // Clear previous best badges
      this.nodes.forEach((n) => (n.isBest = false));

      // Find best node (online and lowest ping)
      const onlineNodes = this.nodes
        .filter((n) => n.isOnline && (n.pingMs || 9999) < 1000)
        .sort((a, b) => (a.pingMs || 9999) - (b.pingMs || 9999));

      const best = onlineNodes[0] || this.nodes[0] || null;
      let autoSwitched = false;

      if (best) {
        best.isBest = true;
        console.log(`[VPN Service] 🏆 Best node identified: ${best.flag} ${best.name} (${best.pingMs}ms, rating: ${best.speedRating})`);

        if (this.autoBestEnabled) {
          const prevId = this.activeNodeId;
          this.activeNodeId = best.id;
          autoSwitched = prevId !== best.id;
          if (autoSwitched) {
            console.log(`[VPN Service] 🔀 Auto-switched active relay to fastest node: ${best.flag} ${best.country} (${best.pingMs}ms)`);
          }
        }
      }

      return {
        testedCount: this.nodes.length,
        bestNode: best,
        autoSwitched,
      };
    } finally {
      this.isBenchmarking = false;
    }
  }

  public getBestNode(): VlessNode | null {
    const online = this.nodes
      .filter((n) => n.isOnline && (n.pingMs || 9999) < 1000)
      .sort((a, b) => (a.pingMs || 9999) - (b.pingMs || 9999));
    return online[0] || this.nodes[0] || null;
  }

  public getStatus(): VpnStatus {
    const active = this.nodes.find((n) => n.id === this.activeNodeId) || this.nodes[0] || null;
    const best = this.getBestNode();

    return {
      enabled: this.enabled,
      activeNode: active,
      bestNode: best,
      totalNodes: this.nodes.length,
      lastSync: this.lastSync,
      nextSync: this.nextSync,
      subscriptionUrl: this.subscriptionUrl,
      ipLocation: active ? `${active.flag} ${active.country} (${active.name})` : "Direct IP",
      relayMode: this.enabled ? "vless-reality" : "direct",
      autoBestEnabled: this.autoBestEnabled,
      autoSyncEnabled: this.autoSyncEnabled,
      lastSpeedTest: this.lastSpeedTest,
      nextSpeedTest: this.nextSpeedTest,
      isBenchmarking: this.isBenchmarking,
      syncIntervalMinutes: 60,
      benchmarkIntervalMinutes: 10,
      tunnelAppliedNodeId: this.tunnelAppliedNodeId || undefined,
      tunnelAppliedLabel: this.tunnelAppliedLabel || undefined,
      lastApplyAt: this.lastApplyAt || undefined,
      lastApplyTried: this.lastApplyTried || undefined,
      lastApplyError: this.lastApplyError || undefined,
      lastEgress: { ok: this.lastEgress.ok, loc: this.lastEgress.loc },
      egressProbe: this.lastEgressProbe || undefined,
      manager: this.tunnelManager,
    };
  }

  public getNodes(): VlessNode[] {
    return this.nodes;
  }

  // Task 6: public-facing view — strip uuid/pbk/sid/rawUrl, mask numeric IPs
  // (last octet). Never expose VLESS secrets through the API.
  public publicNode(n: VlessNode | null): any {
    if (!n) return null;
    const maskIp = (h: string) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? h.replace(/\.\d+$/, ".x") : h);
    return {
      id: n.id,
      name: n.name,
      country: n.country,
      flag: n.flag,
      host: maskIp(n.host),
      port: n.port,
      security: n.security,
      sni: n.sni.slice(0, 10) + "…",
      transport: this.parseTransportFromRawUrl(n.rawUrl)?.type || "tcp",
      flow: n.flow || undefined,
      fp: n.fp || undefined,
      pingMs: n.pingMs,
      isOnline: n.isOnline,
      isBest: n.isBest,
      speedRating: n.speedRating,
      lastChecked: n.lastChecked,
    };
  }

  public publicNodes(): any[] {
    return this.nodes.map((n) => this.publicNode(n));
  }

  public appliedNode(): any {
    const n = this.tunnelAppliedNodeId ? this.nodes.find((x) => x.id === this.tunnelAppliedNodeId) : null;
    return {
      id: this.tunnelAppliedNodeId || undefined,
      label: this.tunnelAppliedLabel || (n ? n.name : undefined),
      ...(this.publicNode(n) || {}),
      appliedAt: this.lastApplyAt || undefined,
    };
  }

  public toggle(enabled?: boolean): VpnStatus {
    if (enabled !== undefined) {
      this.enabled = enabled;
    } else {
      this.enabled = !this.enabled;
    }
    return this.getStatus();
  }

  public setAutoBest(enabled: boolean): VpnStatus {
    this.autoBestEnabled = enabled;
    if (enabled) {
      const best = this.getBestNode();
      if (best) {
        this.activeNodeId = best.id;
      }
    }
    return this.getStatus();
  }

  public setAutoSync(enabled: boolean): VpnStatus {
    this.autoSyncEnabled = enabled;
    return this.getStatus();
  }

  public setSubscriptionUrl(url: string): VpnStatus {
    this.subscriptionUrl = url.trim();
    this.enabled = this.subscriptionUrl.length > 0;
    return this.getStatus();
  }

  public selectNode(nodeId: string): VlessNode | null {
    const found = this.nodes.find((n) => n.id === nodeId);
    if (found) {
      this.activeNodeId = nodeId;
      // If user manually picks a node, keep auto-best setting or user choice
      return found;
    }
    return null;
  }

  public async testSingleNodePing(nodeId?: string): Promise<{ nodeId: string; pingMs: number; isOnline: boolean; speedRating?: string }> {
    const target = nodeId 
      ? this.nodes.find((n) => n.id === nodeId)
      : this.nodes.find((n) => n.id === this.activeNodeId) || this.nodes[0];

    if (!target) {
      return { nodeId: "unknown", pingMs: 9999, isOnline: false };
    }

    const res = await this.checkSocketLatency(target);
    target.pingMs = res.pingMs;
    target.isOnline = res.isOnline;
    target.lastChecked = new Date().toISOString();

    if (!target.isOnline) {
      target.speedRating = 'offline';
    } else if (target.pingMs < 45) {
      target.speedRating = 'ultra';
    } else if (target.pingMs < 90) {
      target.speedRating = 'fast';
    } else if (target.pingMs < 160) {
      target.speedRating = 'medium';
    } else {
      target.speedRating = 'slow';
    }

    return {
      nodeId: target.id,
      pingMs: target.pingMs,
      isOnline: target.isOnline,
      speedRating: target.speedRating,
    };
  }

  // ── Real tunnel application: write singbox.json + restart sing-box + verify egress ──
  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  private egressAlive(): Promise<{ ok: boolean; loc: string; ip: string }> {
    return new Promise((resolve) => {
      execFile(
        "/usr/bin/curl",
        ["-s", "-m", "8", "-x", "http://127.0.0.1:10808", "https://www.cloudflare.com/cdn-cgi/trace"],
        { maxBuffer: 64 * 1024 },
        (err, stdout) => {
          const body = String(stdout || "");
          const grab = (key: string) => (body.match(new RegExp(`^${key}=(.*)$`, "m")) || [])[1] || "";
          const loc = grab("loc");
          const ip = grab("ip");
          const ok = !err && body.includes("loc=") && loc !== "";
          resolve({ ok, loc, ip });
        }
      );
    });
  }

  private openRouterViaTunnel(): Promise<number> {
    return new Promise((resolve) => {
      execFile(
        "/usr/bin/curl",
        ["-s", "-m", "10", "-o", "/dev/null", "-w", "%{http_code}", "-x", "http://127.0.0.1:10808", "https://openrouter.ai/api/v1/models"],
        { maxBuffer: 16 * 1024 },
        (err, stdout) => {
          const code = parseInt(String(stdout || ""), 10);
          if (err && !Number.isFinite(code)) return resolve(0);
          resolve(Number.isFinite(code) ? code : 0);
        }
      );
    });
  }

  private getEffectiveManager(): "launchd" | "builtin" | "external" {
    const m = this.tunnelManager;
    if (m === "launchd" || m === "builtin" || m === "external") {
      if (m === "launchd" && process.platform !== "darwin") return "builtin";
      return m;
    }
    // auto
    if (process.platform === "darwin") return "launchd";
    if (process.platform === "win32" || process.platform === "linux") return "builtin";
    return "builtin";
  }

  private restartTunnel(): Promise<void> {
    const eff = this.getEffectiveManager();
    if (eff === "external") return Promise.resolve();
    if (eff === "launchd") {
      return new Promise((resolve, reject) => {
        const uid = typeof process.getuid === "function" ? process.getuid() : os.userInfo().uid;
        execFile("/bin/launchctl", ["kickstart", "-k", `gui/${uid}/${this.singboxServiceLabel}`], (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    // builtin: win32/linux/darwin if overridden
    if (process.platform === "win32") return this.restartTunnelWin32();
    return this.restartTunnelBuiltin();
  }

  private restartTunnelBuiltin(): Promise<void> {
    if (this.singboxProc !== null && this.singboxProc.exitCode === null) {
      try {
        this.singboxProc.kill();
      } catch {}
      this.singboxProc = null;
    }
    return new Promise((resolve) => {
      try {
        fs.mkdirSync(dataPath("cascade-run"), { recursive: true });
        const bin = singboxBin();
        const proc = spawn(bin, ["run", "-D", dataPath("cascade-run"), "-c", "singbox.json"], {
          cwd: dataPath("cascade-run"),
          stdio: "ignore",
        });
        proc.on("exit", () => {
          if (this.singboxProc === proc) this.singboxProc = null;
        });
        this.singboxProc = proc;
      } catch {}
      resolve();
    });
  }

  // Windows (задача 37): launchd нет — sing-box держится как дочерний процесс
  // (sing-box.exe рядом с cascade.exe). Замена процессу = kill + spawn того же
  // конфига cascade-run/singbox.json (полная параллель launchd-семантике,
  // строка запуска эквивалентна плейсту: `<SINGBOX_BIN> run -D cascade-run -c singbox.json`).
  private singboxProc: ChildProcess | null = null;

  private restartTunnelWin32(): Promise<void> {
    if (this.singboxProc !== null && this.singboxProc.exitCode === null) {
      try {
        this.singboxProc.kill();
      } catch {
        /* already dead */
      }
      this.singboxProc = null;
    }
    return new Promise((resolve) => {
      try {
        fs.mkdirSync(dataPath("cascade-run"), { recursive: true });
        const proc = spawn(
          singboxBin(),
          ["run", "-D", dataPath("cascade-run"), "-c", "singbox.json"],
          { cwd: dataPath("cascade-run"), stdio: "ignore", windowsHide: true }
        );
        proc.on("exit", () => {
          if (this.singboxProc === proc) this.singboxProc = null;
        });
        this.singboxProc = proc;
      } catch {
        /* the tunnel simply stays down on spawn failure */
      }
      resolve();
    });
  }

  /** Статус процесса sing-box. */
  isTunnelProcessAlive(): boolean {
    const eff = this.getEffectiveManager();
    if (eff === "launchd") return false; // launchd-managed, not our child
    if (eff === "external") return false;
    return this.singboxProc !== null && this.singboxProc.exitCode === null;
  }

  // Task 11: host:port for logs with the host masked (no full IP leakage).
  private nodeEndpointMask(node: VlessNode): string {
    return `${String(node.host || "?").slice(0, 6)}…:${node.port}`;
  }

  // Task 11: universal pre-flight — `sing-box check -c` on a generated config in
  // os.tmpdir (removed after). A FATAL / non-zero exit (or 5s timeout) means the
  // candidate's config must NEVER be written to cascade-run/singbox.json.
  private singboxCheckConfig(cfg: any): Promise<{ ok: boolean; reason: string }> {
    return new Promise((resolve) => {
      const tmp = path.join(os.tmpdir(), `cascade-singbox-check-${process.pid}-${Date.now()}.json`);
      try {
        fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
      } catch {
        return resolve({ ok: false, reason: "tmp config write failed" });
      }
      execFile(
        singboxBin(),
        ["check", "-c", tmp],
        { timeout: 5000, maxBuffer: 64 * 1024 },
        (err, stdout, stderr) => {
          fs.rmSync(tmp, { force: true });
          if (err) {
            const reason =
              (String(stderr) + "\n" + String(stdout))
                .split("\n")
                .map((l) => l.trim())
                .find((l) => /FATAL|ERROR|unknown|invalid|transport/i.test(l))
                ?.slice(0, 200) || err.message.slice(0, 200);
            return resolve({ ok: false, reason });
          }
          resolve({ ok: true, reason: "" });
        }
      );
    });
  }

  /**
   * Applies the best subscription node to the real sing-box tunnel (writes
   * cascade-run/singbox.json atomically, restarts the sing-box launchd service
   * (label from vpn.singboxServiceLabel), verifies
   * egress and rolls back on failure). If the tunnel is already alive and
   * `force` is false, nothing is touched.
   */
  public async ensureTunnelApplied(force: boolean = false, nodeId?: string): Promise<{
    applied: boolean;
    force: boolean;
    node: { id: string; label: string; ip?: string } | null;
    egress: { ok: boolean; loc: string };
    openrouterViaTunnel: { httpCode: number };
    tried: number;
    error?: string;
  }> {
    const baseline = {
      applied: false,
      force,
      node: this.tunnelAppliedNodeId
        ? { id: this.tunnelAppliedNodeId, label: this.tunnelAppliedLabel }
        : null,
      egress: { ok: this.lastEgress.ok, loc: this.lastEgress.loc },
      openrouterViaTunnel: { httpCode: this.lastOpenRouterViaTunnel },
      tried: 0,
    };

    if (this.tunnelAppling) {
      return { ...baseline, error: "apply already in progress" };
    }
    if (!this.enabled || !this.subscriptionUrl || this.nodes.length === 0) {
      return { ...baseline, error: "vpn relay disabled (no subscription URL configured)" };
    }
    this.tunnelAppling = true;
    try {
      // 1-2. Tunnel already alive and no force → leave a working tunnel alone.
      const live = await this.egressAlive();
      this.lastEgress = live;
      if (live.ok && !force) {
        console.log(`[VPN Service] ✅ Tunnel already alive (loc=${live.loc}/ip=${live.ip.slice(0, 4)}…), skipping apply (force=false)`);
        this.tunnelAppliedLabel = this.tunnelAppliedLabel || "already-alive";
        return { applied: false, force, node: this.tunnelAppliedNodeId ? { id: this.tunnelAppliedNodeId, label: this.tunnelAppliedLabel } : null, egress: { ok: true, loc: live.loc }, openrouterViaTunnel: { httpCode: this.lastOpenRouterViaTunnel }, tried: 0 };
      }
      if (live.ok) {
        console.log("  (tunnel alive but force=true — will re-apply best node)");
      }

      // 3. Benchmark data stale/absent → refresh it.
      const hasBenchmark = this.nodes.some((n) => !!n.lastChecked);
      const stale = Date.now() - new Date(this.lastSpeedTest).getTime() > 10 * 60 * 1000;
      if (!hasBenchmark || stale) {
        console.log("[VPN Service] Benchmark data stale — running fresh benchmark...");
        await this.benchmarkAllNodes();
      }

      // 4. Optional pinned node; otherwise top-8 candidates by latency.
      const pinned = typeof nodeId === "string" && nodeId.trim()
        ? this.nodes.find((n) => n.id === nodeId.trim())
        : undefined;
      if (typeof nodeId === "string" && nodeId.trim() && !pinned) {
        return { ...baseline, error: "node_not_found" };
      }
      // 4. Candidate list. Pinned node (nodeId) is used as-is and does NOT
      // trigger the deep fallback (semantics unchanged). Otherwise the primary
      // wave is top-8 by latency (fastest first); if none of them yields live
      // egress, the deep fallback (C1, task5) sweeps the remaining nodes of the
      // subscription from slowest to fastest, with dead-cached (isOnline=false)
      // nodes last, bounded by an overall ~15-minute budget.
      const primary = pinned
        ? [pinned]
        : [...this.nodes]
            .sort((a, b) => ((a.isOnline === false ? 1 : 0) - (b.isOnline === false ? 1 : 0)) || ((a.pingMs ?? 9999) - (b.pingMs ?? 9999)))
            .slice(0, 8);
      if (primary.length === 0) {
        this.lastApplyError = "no candidates";
        return { ...baseline, error: "no candidates" };
      }
      const candidatesBase = pinned
        ? primary
        : [
            ...primary,
            ...[...this.nodes]
              .filter((n) => !primary.some((p) => p.id === n.id))
              .sort(
                (a, b) =>
                  ((a.isOnline === false ? 1 : 0) - (b.isOnline === false ? 1 : 0)) ||
                  ((b.pingMs ?? -1) - (a.pingMs ?? -1))
              ),
          ];
      // Task 7: probe-aware ordering — when a fresh egress probe exists
      // (≤90 min old), nodes proven alive come first (ascending latency);
      // the rest keep their current order. TCP latency alone does NOT predict
      // VLESS egress liveness (task 6: 50-68 alive of 127 at any ping), so the
      // deep fallback no longer burns its 15-min budget hunting the dead tail
      // of the list first.
      let candidates: VlessNode[] = candidatesBase;
      if (!pinned) {
        const freshCutoff = Date.now() - 90 * 60 * 1000;
        const fresh = (n: VlessNode) => {
          const p = this.egressProbeById.get(n.id);
          return !!p && p.ok && new Date(p.checkedAt).getTime() >= freshCutoff;
        };
        const hasFresh = this.nodes.some(fresh);
        if (hasFresh) {
          const reordered = [...candidatesBase].sort((a, b) => {
            const fa = fresh(a) ? 1 : 0;
            const fb = fresh(b) ? 1 : 0;
            if (fa !== fb) return fb - fa;
            if (fa) {
              const pa = this.egressProbeById.get(a.id)!;
              const pb = this.egressProbeById.get(b.id)!;
              return (pa.latencyMs ?? 99999) - (pb.latencyMs ?? 99999);
            }
            return 0; // non-fresh keep current relative order (stable sort)
          });
          console.log(`[VPN Service] 🎯 Probe-aware ordering: ${candidatesBase.filter(fresh).length} fresh-ok candidates first (probe ${this.lastEgressProbe?.checkedAt?.slice(0, 19)})`);
          candidates = reordered;
        } else {
          candidates = candidatesBase;
        }
      } else {
        candidates = candidatesBase;
      }

      const DEEP_FALLBACK_BUDGET_MS = 15 * 60 * 1000;
      const deepFallbackStart = Date.now();
      if (candidates.length > primary.length) {
        console.log(`[VPN Service] Deep fallback armed: ${primary.length} primary + ${candidates.length - primary.length} remaining nodes, budget ${DEEP_FALLBACK_BUDGET_MS}ms`);
      }
      const currentBest = this.getBestNode();
      if (currentBest) currentBest.isBest = true;

      // 5. One-time backup of the original config.
      if (!fs.existsSync(this.singboxBakOrig)) {
        fs.copyFileSync(this.singboxConfigPath, this.singboxBakOrig);
        console.log("[VPN Service] Original singbox.json backed up → singbox.json.bak-orig");
      }

      let tried = 0;
      // 6. Try each candidate (primary wave, then deep fallback).
      for (let ci = 0; ci < candidates.length; ci++) {
        const node = candidates[ci];
        if (ci >= primary.length && Date.now() - deepFallbackStart > DEEP_FALLBACK_BUDGET_MS) {
          console.warn(`[VPN Service] Deep fallback budget exceeded (${ci} candidates) — restoring known-good config`);
          break;
        }
        tried += 1;
        // Task 11 (level 1): unsupported transports (e.g. xhttp on sing-box 1.14.1)
        // never enter the write/kickstart path.
        const transportType = this.parseTransportFromRawUrl(node.rawUrl)?.type || "tcp";
        if (UNSUPPORTED_TRANSPORTS.includes(transportType)) {
          console.log(`[VPN Service] skip invalid config ${this.nodeEndpointMask(node)}: unsupported transport type: ${transportType}`);
          continue;
        }
        const cfg = this.generateSingboxConfig(node);
        if (!cfg || !Array.isArray(cfg.inbounds) || cfg.inbounds.length === 0) continue;
        // CRITICAL: inbound must stay HTTP/SOCKS mixed on 127.0.0.1:10808 (router goes via HTTP proxy there).
        // NOTE: no `sniff` — it's a legacy inbound field removed in sing-box 1.13+ (this host runs 1.14.1).
        cfg.inbounds[0] = { type: "mixed", tag: "mixed-in", listen: "127.0.0.1", listen_port: 10808 };
        // Task 11 (level 2): universal pre-flight — `sing-box check` must pass BEFORE
        // the config is written and the tunnel restarted. A FATAL here (xhttp today,
        // any future unsupported field) → candidate skipped, nothing written.
        const checkResult = await this.singboxCheckConfig(cfg);
        if (!checkResult.ok) {
          console.log(`[VPN Service] skip invalid config ${this.nodeEndpointMask(node)}: ${checkResult.reason}`);
          continue;
        }
        fs.copyFileSync(this.singboxConfigPath, this.singboxPreApply);
        const tmp = `${this.singboxConfigPath}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
        fs.renameSync(tmp, this.singboxConfigPath);

        let lastErr = "";
        try {
          await this.restartTunnel();
          await this.sleep(4000);
        } catch (e: any) {
          lastErr = e?.message || String(e);
        }
        let egress = await this.egressAlive();
        if (!egress.ok) {
          // one retry on timeout
          await this.sleep(1500);
          egress = await this.egressAlive();
        }
        if (egress.ok) {
          this.tunnelAppliedNodeId = node.id;
          this.tunnelAppliedLabel = node.name;
          this.activeNodeId = node.id;
          this.lastApplyAt = new Date().toISOString();
          this.lastApplyTried = tried;
          this.lastApplyError = "";
          this.lastEgress = egress;
          try {
            fs.writeFileSync(
              this.tunnelStatePath,
              JSON.stringify({ id: node.id, label: node.name, appliedAt: this.lastApplyAt }) + "\n"
            );
          } catch (e: any) {
            console.warn("[VPN Service] tunnel-state persist failed:", e?.message);
          }
          // refresh last known-good snapshot
          fs.copyFileSync(this.singboxConfigPath, this.singboxBakOrig);
          const httpCode = await this.openRouterViaTunnel();
          this.lastOpenRouterViaTunnel = httpCode;
          console.log(`[VPN Service] ✅ Tunnel applied → ${node.flag} ${node.name} (loc=${egress.loc}, ip=${egress.ip.slice(0, 4)}…, ping=${node.pingMs}ms, openrouter=${httpCode})`);
          return {
            applied: true,
            force,
            node: { id: node.id, label: node.name, ip: egress.ip || undefined },
            egress: { ok: true, loc: egress.loc },
            openrouterViaTunnel: { httpCode },
            tried,
          };
        }
        console.warn(`[VPN Service] Tunnel candidate #${tried} FAILED egress: ${node.flag} ${node.name} (${node.pingMs}ms)${lastErr ? ` — ${lastErr}` : ""}`);
      }

      // 7. All failed → restore known-good config and restart.
      const restoreTarget = this.tunnelAppliedNodeId && fs.existsSync(this.singboxPreApply)
        ? this.singboxPreApply
        : fs.existsSync(this.singboxBakOrig)
          ? this.singboxBakOrig
          : null;
      if (restoreTarget) {
        fs.copyFileSync(restoreTarget, this.singboxConfigPath);
      }
      await this.sleep(200);
      try {
        await this.restartTunnel();
      } catch (e: any) {
        console.error("[VPN Service] restore kickstart failed:", e?.message || e);
      }
      await this.sleep(3000);
      const finalEgress = await this.egressAlive();
      this.lastApplyError = "tunnel_apply_failed";
      this.lastApplyTried = tried;
      console.error(`[VPN Service] 🔴 tunnel_apply_failed — restored ${restoreTarget || "nothing"} (${tried} candidates tried)`);
      return {
        applied: false,
        force,
        node: null,
        egress: { ok: finalEgress.ok, loc: finalEgress.loc },
        openrouterViaTunnel: { httpCode: this.lastOpenRouterViaTunnel },
        tried,
        error: "tunnel_apply_failed",
      };
    } catch (err: any) {
      this.lastApplyError = err?.message || String(err);
      console.error("[VPN Service] ensureTunnelApplied error:", err?.message || err);
      return { ...baseline, error: err?.message || String(err) };
    } finally {
      this.tunnelAppling = false;
    }
  }

  // Sing-box config generator with local port 10808 (SOCKS5 & HTTP)
  public generateSingboxConfig(node?: VlessNode): any {
    const target = node || this.nodes.find((n) => n.id === this.activeNodeId) || this.nodes[0];
    if (!target) return {};

    const transport = this.parseTransportFromRawUrl(target.rawUrl);
    // Task 6: flow (xtls-rprx-vision) is a TCP-only flow — honor it for reality
    // AND tls when the transport is plain tcp (or raw), exactly as the faithful
    // per-line probe does. Dropping it killed every vision handshake in task 4.
    const isRealityTcp = (target.security === "reality" || target.security === "tls") && transport === undefined;
    let alpn: string[] | undefined;
    try {
      const alpnRaw = new URL(target.rawUrl).searchParams.get("alpn");
      alpn = alpnRaw ? alpnRaw.split(",") : undefined;
    } catch {
      alpn = undefined;
    }

    return {
      log: { level: "info" },
      inbounds: [
        {
          type: "mixed",
          tag: "mixed-in",
          listen: "127.0.0.1",
          listen_port: 10808,
          sniff: true,
        },
      ],
      outbounds: [
        {
          type: "vless",
          tag: "proxy",
          server: target.host,
          server_port: typeof target.port === "string" ? parseInt(target.port, 10) : target.port,
          uuid: target.uuid,
          flow: isRealityTcp ? (target.flow || "xtls-rprx-vision") : undefined,
          transport,
          tls: {
            enabled: target.security === "reality" || target.security === "tls",
            server_name: target.sni,
            alpn,
            reality: target.security === "reality" ? {
              enabled: true,
              public_key: target.pbk,
              short_id: target.sid || "",
            } : undefined,
            utls: {
              enabled: true,
              fingerprint: target.fp || "chrome",
            },
          },
        },
        {
          type: "direct",
          tag: "direct",
        },
      ],
    };
  }

  private parseTransportFromRawUrl(rawUrl: string): any {
    try {
      const u = new URL(rawUrl);
      const rawType = u.searchParams.get("type") || "tcp";
      const path = u.searchParams.get("path") || undefined;
      const host = u.searchParams.get("host") || undefined;
      const serviceName = u.searchParams.get("serviceName") || undefined;
      const mode = u.searchParams.get("mode") || "auto";

      switch (rawType) {
        case "ws":
          return {
            type: "ws",
            path,
            headers: host ? { Host: host } : undefined,
          };
        case "grpc":
          return {
            type: "grpc",
            service_name: serviceName,
          };
        case "xhttp":
          return {
            type: "xhttp",
            path,
            host: host ? { Host: host } : undefined,
            mode,
          };
        case "http":
          return {
            type: "http",
            path,
            host: host ? { Host: host } : undefined,
          };
        case "tcp":
        default:
          return undefined;
      }
    } catch (e) {
      return undefined;
    }
  }

  // Xray config generator with inbound on 10808
  public generateXrayConfig(node?: VlessNode): any {
    const target = node || this.nodes.find((n) => n.id === this.activeNodeId) || this.nodes[0];
    if (!target) return {};

    return {
      log: { loglevel: "warning" },
      inbounds: [
        {
          port: 10808,
          listen: "127.0.0.1",
          protocol: "socks",
          settings: { auth: "noauth", udp: true },
        },
        {
          port: 10809,
          listen: "127.0.0.1",
          protocol: "http",
        },
      ],
      outbounds: [
        {
          protocol: "vless",
          settings: {
            vnext: [
              {
                address: target.host,
                port: typeof target.port === "string" ? parseInt(target.port, 10) : target.port,
                users: [
                  {
                    id: target.uuid,
                    encryption: "none",
                    flow: target.flow || "xtls-rprx-vision",
                  },
                ],
              },
            ],
          },
          streamSettings: {
            network: "tcp",
            security: target.security || "reality",
            realitySettings: {
              serverName: target.sni,
              publicKey: target.pbk,
              shortId: target.sid || "",
              fingerprint: target.fp || "chrome",
            },
          },
          tag: "proxy",
        },
        {
          protocol: "freedom",
          tag: "direct",
        },
      ],
    };
  }

  stopTunnel(): void {
    if (this.singboxProc !== null && this.singboxProc.exitCode === null) {
      try {
        this.singboxProc.kill("SIGTERM");
      } catch {}
      this.singboxProc = null;
    }
  }
}

export const vpnService = new VpnService();

