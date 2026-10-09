// probe-core.mjs — shared faithful per-line VLESS egress probe for Cascade.
// Used by BOTH the CLI (probe-vless-subscription.mjs) and the background
// probe in server/vpnService.ts after every hourly sync. No top-level side
// effects (safe to import). NO SECRETS IN OUTPUT: uuid/pbk/sid never printed;
// numeric IPs masked (last octet).
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'

const execFileAsync = promisify(execFile)

export const SGBOX = process.env.SGBOX || '/opt/homebrew/bin/sing-box'

function buildTransport(raw) {
  const u = new URL(raw)
  const rawType = u.searchParams.get('type') || 'tcp'
  const path = u.searchParams.get('path') || undefined
  const host = u.searchParams.get('host') || undefined
  const serviceName = u.searchParams.get('serviceName') || undefined
  const mode = u.searchParams.get('mode') || 'auto'
  switch (rawType) {
    case 'ws': return { type: 'ws', path, ...(host ? { headers: { Host: host } } : {}) }
    case 'grpc': return { type: 'grpc', service_name: serviceName }
    case 'xhttp': return { type: 'xhttp', path, ...(host ? { host: { Host: host } } : {}), mode }
    default: return undefined // tcp and raw (xray plain tcp) -> none in sing-box
  }
}

export function parseFields(raw) {
  const u = new URL(raw)
  const q = u.searchParams
  const sec = q.get('security') || 'none'
  const transport = buildTransport(raw)
  const isRealityTcp = (sec === 'reality' || sec === 'tls') && transport === undefined
  return {
    host: u.hostname,
    port: u.port ? parseInt(u.port, 10) : 443,
    uuid: u.username,
    sec,
    transport,
    sni: q.get('sni') || u.hostname,
    pbk: q.get('pbk') || '',
    sid: q.get('sid') || '',
    fp: q.get('fp') || 'chrome',
    flow: isRealityTcp ? (q.get('flow') || undefined) : undefined,
    alpn: q.get('alpn') ? q.get('alpn').split(',') : undefined,
  }
}

export function buildConfig(raw, listenPort) {
  const f = parseFields(raw)
  return {
    log: { level: 'warn' },
    inbounds: [{ type: 'mixed', tag: 'mixed-in', listen: '127.0.0.1', listen_port: listenPort }],
    outbounds: [{
      type: 'vless', tag: 'proxy',
      server: f.host, server_port: f.port, uuid: f.uuid,
      flow: f.flow, transport: f.transport,
      tls: {
        enabled: f.sec === 'reality' || f.sec === 'tls',
        server_name: f.sni,
        alpn: f.alpn,
        ...(f.sec === 'reality' ? { reality: { enabled: true, public_key: f.pbk, short_id: f.sid } } : {}),
        utls: { enabled: true, fingerprint: f.fp },
      },
    }, { type: 'direct', tag: 'direct' }],
  }
}

export function tcpCheck(host, port, ms = 2500) {
  return new Promise((resolve) => {
    const s = new net.Socket(); let d = false
    const fin = (ok) => { if (!d) { d = true; try { s.destroy() } catch {} resolve(ok) } }
    s.setTimeout(ms)
    s.once('connect', () => fin(true))
    s.once('timeout', () => fin(false))
    s.once('error', () => fin(false))
    s.connect(parseInt(port, 10) || 443, host)
  })
}

const mask = (host) => { const parts = host.split('.'); if (parts.length === 4) parts[3] = 'x'; return parts.join('.') }
const hp = (h, p) => `${mask(h)}:${p}`

async function verifyIpify(port) {
  try {
    const { stdout } = await execFileAsync('/usr/bin/curl', ['-s', '-m', '8', '-x', `http://127.0.0.1:${port}`, 'https://api.ipify.org'], { encoding: 'utf8', timeout: 10000 })
    const out = stdout.trim()
    return { ipifyOk: /^\d+(\.\d+){3}$/.test(out), ipify: /^\d+(\.\d+){3}$/.test(out) ? mask(out) : '' }
  } catch { return { ipifyOk: false, ipify: '' } }
}

// One node through its own sing-box instance on `port`. Returns a record
// (never prints secrets). beforeKill runs BEFORE SIGKILL so the tunnel is
// still up when a second IP check is performed.
export async function probeRaw(raw, port, tag, beforeKill) {
  const work = `${process.env.PROBE_WORK || '/tmp/cascade-probe'}/i-${tag}`
  mkdirSync(work, { recursive: true })
  const confPath = `${work}/config.json`
  writeFileSync(confPath, JSON.stringify(buildConfig(raw, port), null, 2))
  let proc
  try {
    proc = spawn(SGBOX, ['run', '-D', work, '-c', confPath], { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch { return { ok: false, down: 'spawn-fail' } }
  let logs = ''
  proc.stdout && proc.stdout.on('data', (c) => { logs += c })
  proc.stderr && proc.stderr.on('data', (c) => { logs += c })
  return new Promise((resolve) => {
    let done = false
    const fin = async (r, extra) => {
      if (done) return; done = true
      if (r.ok && typeof beforeKill === 'function') {
        try { Object.assign(r, await beforeKill()) } catch { Object.assign(r, { ipify: '', ipifyOk: false }) }
      }
      try { proc.kill('SIGKILL') } catch {}
      setTimeout(() => resolve({ ...r, exited: proc.exitCode !== null, log: logs.slice(0, 600), ...extra }), 80)
    }
    proc.once('exit', (code) => { if (!done) fin({ ok: false, down: 'exit', exitCode: code }) })
    setTimeout(async () => {
      if (proc.exitCode !== null) return fin({ ok: false, down: 'exit' })
      const start = Date.now()
      try {
        const { stdout } = await execFileAsync('/usr/bin/curl', ['-s', '-m', '10', '-x', `http://127.0.0.1:${port}`, 'https://www.cloudflare.com/cdn-cgi/trace'], { encoding: 'utf8', timeout: 12000 })
        const out = stdout || ''
        const loc = (out.match(/^loc=(.*)$/m) || [])[1] || ''
        const ip = (out.match(/^ip=(.*)$/m) || [])[1] || ''
        await fin({ ok: !!loc, loc, ip, latMs: Date.now() - start, err: '' })
      } catch (e) {
        const m = String(e.message || e)
        fin({ ok: false, loc: '', ip: '', latMs: Date.now() - start, down: proc.exitCode !== null ? 'exit' : 'egress-timeout', err: m.slice(0, 60) })
      }
    }, 2000)
  })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Items: [{ id, raw }]. Parallel-limited worker pool, one sing-box per node on
// sequential dynamic ports (>= portsBase), SIGKILL after each check, budget to
// bound total runtime. Caller can pass onRecord(rec) per finished node.
export async function probeNodes(items, opts = {}) {
  const PAR = opts.parallel || 8
  const BASE = opts.portsBase || 12200
  const BUDGET_MS = opts.budgetMs || 10 * 60 * 1000
  const ipifyPerHost = opts.ipifyPerHost !== false
  const onRecord = opts.onRecord || (() => {})
  const startedAt = new Date().toISOString()
  const record = (id, raw, extra) => {
    const f = parseFields(raw)
    return { id, hp: hp(f.host, f.port), sec: f.sec, transport: f.transport ? f.transport.type : '', flow: f.flow || '', fp: f.fp, ...extra }
  }
  const ipifyDone = new Set()
  let nextPort = BASE
  const results = []
  let cursor = 0
  const failByType = {}
  const workers = []
  const runWorker = async () => {
    for (;;) {
      if (Date.now() - new Date(startedAt).getTime() > BUDGET_MS) return
      const i = cursor++
      if (i >= items.length) return
      const { id, raw } = items[i]
      const f = parseFields(raw)
      const port = nextPort++
      let rec = record(id, raw, {})
      rec.latMs = 0
      const tcp = await tcpCheck(f.host, f.port)
      rec.tcp_ok = tcp
      if (!tcp) {
        rec.ok = false; rec.down = 'tcp-blocked'
        rec.checkedAt = new Date().toISOString()
        failByType['tcp-blocked'] = (failByType['tcp-blocked'] || 0) + 1
        results.push(rec); onRecord(rec)
        console.log(`PROBE  #${id.slice(0, 16)} ${rec.hp} type=${rec.transport || 'tcp'} ${rec.sec} fp=${rec.fp} → tcp-blocked`)
        continue
      }
      const pr = await probeRaw(raw, port, `p${i}`, ipifyPerHost
        ? () => { const hpk = hp(f.host, f.port); if (ipifyDone.has(hpk)) return Promise.resolve({ ipify: '', ipifyOk: true }); ipifyDone.add(hpk); return verifyIpify(port) }
        : () => verifyIpify(port))
      rec.latMs = pr.latMs || 99999
      if (!pr.ok) {
        rec.ok = false
        rec.down = pr.down || 'egress-timeout'
        rec.checkedAt = new Date().toISOString()
        failByType[rec.down] = (failByType[rec.down] || 0) + 1
        results.push(rec); onRecord(rec)
        console.log(`PROBE  #${id.slice(0, 16)} ${rec.hp} type=${rec.transport || 'tcp'} ${rec.sec} fp=${rec.fp} → ${rec.down}`)
        continue
      }
      rec.ok = true
      rec.loc = pr.loc
      rec.checkedAt = new Date().toISOString()
      rec.ipifyOk = pr.ipifyOk
      results.push(rec); onRecord(rec)
      console.log(`LIVE   #${id.slice(0, 16)} ${rec.hp} type=${rec.transport || 'tcp'} ${rec.sec} fp=${rec.fp} loc=${rec.loc} ip=${(pr.ip || '').slice(0, 9)}… ${rec.latMs}ms ipify=${pr.ipifyOk}`)
    }
  }
  for (let w = 0; w < Math.min(PAR, items.length); w++) workers.push(runWorker())
  await Promise.all(workers)
  const alive = results.filter((r) => r.ok)
  const okHosts = new Set(alive.map((r) => r.hp))
  const finishedAt = new Date().toISOString()
  return {
    startedAt, finishedAt,
    total: results.length,
    ok: alive.length,
    okHosts: okHosts.size,
    failByType,
    results,
  }
}

export function cleanupProbeWork() {
  try { rmSync(process.env.PROBE_WORK || '/tmp/cascade-probe', { recursive: true, force: true }) } catch {}
}

export { mask, hp, sleep }