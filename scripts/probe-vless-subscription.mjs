#!/usr/bin/env node
// Faithful per-line VLESS subscription probe for Cascade (sing-box 1.14.1).
// Thin CLI over scripts/probe-core.mjs (shared with the background probe in
// server/vpnService.ts). NO SECRETS IN OUTPUT; IPs masked (last octet).
// Usage: node scripts/probe-vless-subscription.mjs <sub-file> [--parallel N] [--filter host:port] [--ports-base N]
import { readFileSync } from 'node:fs'
import { probeNodes, cleanupProbeWork } from './probe-core.mjs'

const args = process.argv.slice(2)
const subFile = args.find((a) => !a.startsWith('--')) || '/tmp/cascade-task6/sub-fresh.txt'
const PAR = parseInt((args.find((a) => a.startsWith('--parallel')) || '').split('=')[1] || '8', 10)
const FILTER = (args.find((a) => a.startsWith('--filter')) || '').split('=')[1] || ''
const BASE = parseInt((args.find((a) => a.startsWith('--ports-base')) || '').split('=')[1] || '12200', 10)
const IPIFY_PER_HOST = args.includes('--ipify-per-host')
const hasReprobe = args.some((a) => a.startsWith('--reprobe-ok'))

const rawLinesAll = readFileSync(subFile, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('vless://'))
const items = rawLinesAll
  .map((raw, idx) => ({ id: String(idx), raw }))
  .filter(({ raw }) => !FILTER || raw.includes(FILTER))

const res = await probeNodes(items, { parallel: PAR, portsBase: BASE, ipifyPerHost: IPIFY_PER_HOST })
cleanupProbeWork()

// Rebuild the legacy idx-based record shape (idx = vless-line index; raw
// file line number = idx + 3 header comments) for CLI backwards compatibility.
const byId = new Map(res.results.map((r) => [r.id, r]))
const records = items.map(({ id }) => byId.get(id) || { id })
const out = {
  generated: res.finishedAt,
  subFile,
  total: res.total,
  alive: res.ok,
  okHosts: res.okHosts,
  failByType: res.failByType,
  results: records.map((r) => ({ ...r, idx: parseInt(r.id, 10) })),
}
const outPath = hasReprobe ? '/tmp/cascade-sub-probe-results-final.json' : '/tmp/cascade-sub-probe-results.json'
const { writeFileSync } = await import('node:fs')
writeFileSync(outPath, JSON.stringify(out, null, 2))

console.log('\n=== SUMMARY ===')
console.log(`lines probed: ${res.total} | alive: ${res.ok} | unique host:port alive: ${res.okHosts}`)
console.log('fail by type:', JSON.stringify(res.failByType))
const ipifyN = res.results.filter((r) => r.ok && r.ipifyOk).length
console.log(`alive with ipify confirm: ${ipifyN}/${res.ok}`)
for (const r of res.results.filter((r) => r.ok).sort((a, b) => (a.latMs || 99999) - (b.latMs || 99999))) {
  console.log(`  OK  ${String(r.latMs).padStart(5)}ms #${r.id} ${r.hp} ${r.transport || 'tcp'} ${r.sec} fp=${r.fp} loc=${r.loc} ip=${r.ip ? r.ip.slice(0, 12) + '…' : ''} ipify=${r.ipifyOk}`)
}
console.log('saved', outPath, '| runtime', (new Date(res.finishedAt).getTime() - new Date(res.startedAt).getTime()) / 1000, 's')