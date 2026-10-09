/**
 * First-run on-boarding wizard (Task 37, Windows single-exe build).
 * Shown instead of the dashboard while the router has no configured provider
 * keys. Writes config.json + .env via POST /api/setup/apply (server-side,
 * idempotent); the API never returns key values — only hasApiKey flags.
 */
import React, { useState, useEffect } from 'react';
import { KeyRound, Network, Save, Loader2, CheckCircle2, ShieldCheck, Server } from 'lucide-react';

const PROVIDER_NAMES: Record<string, string> = {
  llm7: 'LLM7',
  groq: 'Groq',
  openrouter: 'OpenRouter',
  qwen: 'Qwen (DashScope)',
  cloudflare: 'Cloudflare',
  mistral: 'Mistral',
  googleai: 'Google AI (Gemini)',
  zai: 'Z.ai',
};

interface SetupStatus {
  configExists: boolean;
  needsSetup: boolean;
  providers: { id: string; hasApiKey: boolean }[];
  tunnel: { configured: boolean };
  catalogOk: boolean;
}

export default function FirstRunWizard({ onDone }: { onDone: () => void }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [providerKeys, setProviderKeys] = useState<Record<string, string>>({});
  const [subscriptionUrl, setSubscriptionUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((d) => {
        setStatus(d);
        if (d && !d.needsSetup) onDone();
      })
      .catch(() => setStatus({ configExists: false, needsSetup: true, providers: [], tunnel: { configured: false }, catalogOk: false }));
  }, [onDone]);

  const setKey = (id: string, v: string) => setProviderKeys((k) => ({ ...k, [id]: v }));

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const r = await fetch('/api/setup/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ providers: providerKeys, subscriptionUrl }),
      });
      const d = await r.json();
      if (!r.ok || !d.success) {
        setError(d?.error || 'Failed to save configuration');
        setSubmitting(false);
        return;
      }
      setSaved(true);
      setTimeout(() => onDone(), 700);
    } catch (e: any) {
      setError(e?.message || 'Failed to apply configuration');
      setSubmitting(false);
    }
  };

  const providerIds =
    status?.providers && status.providers.length > 0
      ? status.providers
      : (Object.keys(PROVIDER_NAMES).map((id) => ({ id, hasApiKey: false })));

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6 font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      <div className="w-full max-w-2xl bg-slate-900/60 border border-slate-700/60 rounded-2xl p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
            <Server className="w-5 h-5 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold">Cascade — first run</h1>
        </div>
        <p className="text-slate-400 mb-6 text-sm">
          Add at least one API key to start routing free AI models. Keys are stored only on this machine, next to the
          app (cascade-run/config.json). Leaving a field empty keeps its previous value.
        </p>

        <div className="mb-6">
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold mb-3">
            <KeyRound className="w-4 h-4" /> Provider API keys
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {providerIds.map((p) => (
              <label key={p.id} className="block">
                <span className="text-xs text-slate-300 flex items-center gap-1.5">
                  {PROVIDER_NAMES[p.id] || p.id}
                  {p.hasApiKey && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
                </span>
                <input
                  type="password"
                  value={providerKeys[p.id] || ''}
                  onChange={(e) => setKey(p.id, e.target.value)}
                  placeholder={p.hasApiKey ? 'configured — leave empty to keep' : 'sk-…'}
                  className="mt-1 w-full rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="mb-6">
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold mb-1">
            <Network className="w-4 h-4" /> VPN tunnel (optional)
          </div>
          <p className="text-xs text-slate-500 mb-2">
            VLESS Reality subscription URL to relay geo-restricted providers. Empty disables the tunnel — direct
            providers keep working.
          </p>
          <input
            type="text"
            value={subscriptionUrl}
            onChange={(e) => setSubscriptionUrl(e.target.value)}
            placeholder="vless://… (optional)"
            className="w-full rounded-lg bg-slate-800/80 border border-slate-700 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {error && <div className="mb-4 text-sm text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">{error}</div>}

        {saved ? (
          <div className="flex items-center gap-2 text-emerald-400 text-sm font-semibold">
            <CheckCircle2 className="w-4 h-4" /> Configuration saved — starting up…
          </div>
        ) : (
          <button
            onClick={submit}
            disabled={submitting}
            className="w-full flex items-center justify-center gap-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 transition-colors px-4 py-3 font-semibold text-sm"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save and start
          </button>
        )}

        <div className="mt-6 flex items-start gap-2 text-xs text-slate-500">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
          Your keys are never uploaded anywhere — Cascade is a local router. The setup screen only reports which
          providers have a key ({'hasApiKey'}), never the values.
        </div>
      </div>
    </div>
  );
}