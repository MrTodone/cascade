import React, { useEffect, useRef, useState } from 'react';
import { RoutingState } from '../types';
import {
  RefreshCw,
  Route,
  Lock,
  AlertTriangle,
  KeyRound,
  Globe,
  Shield,
  CheckCircle2,
  XCircle,
  Clock,
  Gauge,
} from 'lucide-react';

interface RoutingPanelProps {
  onStateChange?: (state: RoutingState) => void;
}

const HEALTH_META: Record<RoutingState['models'][number]['health'], { label: string; cls: string; dot: string }> = {
  ok: { label: 'работает', cls: 'text-emerald-400', dot: 'bg-emerald-400' },
  degraded: { label: 'деградация', cls: 'text-amber-400', dot: 'bg-amber-400' },
  broken: { label: 'недоступна', cls: 'text-rose-400', dot: 'bg-rose-400' },
  unknown: { label: 'нет данных', cls: 'text-slate-500', dot: 'bg-slate-600' },
};

const formatContext = (tokens: number) => {
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k`;
  return `${tokens}`;
};

export const RoutingPanel: React.FC<RoutingPanelProps> = ({ onStateChange }) => {
  const [state, setState] = useState<RoutingState | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [selectedId, setSelectedId] = useState<string>('');
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const applyState = (s: RoutingState) => {
    setState(s);
    onStateChange?.(s);
    if (s.mode === 'manual' && s.pinned) setSelectedId(s.pinned.id);
  };

  const fetchState = async () => {
    try {
      const res = await fetch('/api/routing');
      const data = await res.json();
      if (data.mode) applyState(data);
      setError(null);
    } catch (err) {
      setError('Не удалось получить состояние маршрутизации');
      console.error('RoutingPanel fetch error:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchState();
    pollTimer.current = setInterval(fetchState, 60000);
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const switchToManual = () => {
    setError(null);
    setNotice(null);
    setPicking(true);
  };

  const setAutoMode = async () => {
    setPicking(false);
    setSubmitting(true);
    setNotice(null);
    try {
      const res = await fetch('/api/routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'auto' }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Ошибка при смене режима');
        return;
      }
      if (data.mode) applyState(data);
      setNotice('Режим Авто восстановлен: голый "cascade" снова идёт в каскад из 60 моделей.');
    } catch (err) {
      setError('Ошибка сети при смене режима');
      console.error('RoutingPanel switch error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const pinModel = async (id: string) => {
    if (!id) return;
    setSubmitting(true);
    setNotice(null);
    setError(null);
    try {
      const res = await fetch('/api/routing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'manual', id }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error?.message || 'Не удалось закрепить модель');
        return;
      }
      if (data.mode) applyState(data);
      setPicking(false);
      setNotice('Режим Ручной включён: голый "cascade" теперь строго пинится на выбранную модель.');
    } catch (err) {
      setError('Ошибка сети при закреплении модели');
      console.error('RoutingPanel pin error:', err);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 flex items-center gap-3 text-slate-400 text-sm">
        <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
        Загружаю состояние каскада...
      </div>
    );
  }

  if (!state) {
    return (
      <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-5 text-slate-400 text-sm">
        {error || 'Markup: state not loaded'}
      </div>
    );
  }

  const healthCounts = state.models.reduce<Record<string, number>>(
    (acc, m) => {
      acc[m.health] = (acc[m.health] || 0) + 1;
      return acc;
    },
    { ok: 0, broken: 0, degraded: 0, unknown: 0 }
  );

  return (
    <div className="bg-slate-900/70 border border-slate-800 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Route className="w-5 h-5 text-emerald-400" />
            <span
              className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ${state.mode === 'manual' ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}
            ></span>
          </div>
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="font-mono text-[11px] text-emerald-400/80 uppercase tracking-wider">cascade</span>
              Каскад активного сета
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {state.mode === 'auto' ? (
                <>
                  Авто — каскад{' '}
                  <strong className="text-white">{state.activeSet.modelCount}</strong> моделей (сет «{state.activeSet.name}»)
                </>
              ) : state.pinned ? (
                <>
                  Ручной: <strong className="text-white">{state.pinned.name}</strong>{' '}
                  <span className="text-slate-500">(pin: {state.pinned.provider} / {state.pinned.model})</span>
                </>
              ) : (
                <>Ручной — пин недоступен</>
              )}
            </p>
          </div>
        </div>

        {state.stale && (
          <div className="flex items-center gap-1.5 text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded-lg px-2.5 py-1 text-[11px] font-medium">
            <AlertTriangle className="w-3.5 h-3.5" />
            Пин больше не в активном сете — «cascade» будет отклоняться (503). Переключите в Авто.
          </div>
        )}

        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-500 font-mono">
            {healthCounts.ok}/{state.models.length} работают
            {healthCounts.broken > 0 && <span className="text-rose-400">, {healthCounts.broken} недоступны</span>}
          </span>
          <button
            onClick={fetchState}
            title="Обновить"
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mode switch */}
      <div className="px-5 py-3 border-b border-slate-800 flex flex-wrap items-center gap-3">
        <div className="flex rounded-xl border border-slate-700 overflow-hidden">
          <button
            disabled={submitting}
            onClick={setAutoMode}
            className={`px-4 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors ${
              state.mode === 'auto' && !picking ? 'bg-emerald-600/25 text-emerald-300' : 'bg-slate-900 hover:bg-slate-800 text-slate-400'
            }`}
          >
            <Route className="w-3.5 h-3.5" />
            Авто
          </button>
          <button
            disabled={submitting}
            onClick={switchToManual}
            className={`px-4 py-1.5 text-[11px] font-semibold flex items-center gap-1.5 transition-colors ${
              state.mode === 'manual' || picking ? 'bg-amber-600/25 text-amber-300' : 'bg-slate-900 hover:bg-slate-800 text-slate-400'
            }`}
          >
            <Lock className="w-3.5 h-3.5" />
            Ручной
          </button>
        </div>

        {(state.mode === 'manual' || picking) && (
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
            {picking && <span className="text-[11px] text-amber-300/90">Выберите модель для закрепления</span>}
            <select
              value={selectedId}
              disabled={submitting}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedId(id);
                if (picking && id) pinModel(id);
              }}
              className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1.5 text-[11px] font-mono text-slate-200 outline-none focus:border-emerald-500/60 min-w-0 max-w-full flex-1"
            >
              <option value="">— выберите модель —</option>
              {state.models.map((m) => (
                <option key={m.id} value={m.id}>
                  #{m.priority} {m.name} — {m.provider} ({formatContext(m.context)} ctx, {m.health})
                </option>
              ))}
            </select>
            {state.mode === 'manual' && (
              <button
                disabled={submitting || !selectedId || (state.pinned?.id ?? null) === selectedId}
                onClick={() => pinModel(selectedId)}
                className="px-3.5 py-1.5 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 disabled:opacity-40 text-amber-300 text-[11px] font-semibold border border-amber-500/40 transition-colors"
              >
                <Lock className="w-3 h-3 inline mr-1" />
                Закрепить
              </button>
            )}
          </div>
        )}

        {state.mode === 'auto' && !picking && (
          <span className="text-[11px] text-slate-500">
            Голый <code className="font-mono text-emerald-400/80">cascade</code> маршрутизируется по каскаду из{' '}
            {state.models.length} моделей в порядке приоритета.
          </span>
        )}
      </div>

      {notice && (
        <div className="px-5 py-2 bg-emerald-500/10 border-b border-emerald-500/25 text-emerald-300 text-[11px]">
          {notice}
        </div>
      )}
      {error && (
        <div className="px-5 py-2 bg-rose-500/10 border-b border-rose-500/25 text-rose-300 text-[11px]">
          {error}
        </div>
      )}

      {/* Cascade list */}
      <div className="max-h-72 overflow-y-auto">
        {state.models.map((m) => {
          const health = HEALTH_META[m.health];
          const isPinned = state.mode === 'manual' && state.pinned?.id === m.id;
          return (
            <div
              key={m.id}
              onClick={picking ? () => pinModel(m.id) : undefined}
              className={`flex items-center gap-3 px-5 py-2 border-b border-slate-800/50 last:border-b-0 ${
                isPinned ? 'bg-amber-500/10' : 'hover:bg-slate-900/50'
              } ${picking ? 'cursor-pointer' : ''}`}
            >
              <span className="w-7 text-[11px] font-mono text-slate-500 shrink-0 text-right">#{m.priority}</span>
              <span
                className={`flex h-2 w-2 rounded-full shrink-0 ${health.dot} ${m.health === 'broken' ? 'animate-pulse' : ''}`}
                title={health.label}
              ></span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[11px] font-semibold truncate ${isPinned ? 'text-amber-300' : 'text-slate-200'}`}>
                    {m.name}
                  </span>
                  {isPinned && (
                    <span className="text-[10px] font-mono text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded px-1.5 py-0.5">
                      PIN
                    </span>
                  )}
                </div>
                <div className="text-[10px] font-mono text-slate-500 truncate">
                  {m.model}
                </div>
              </div>
              <span className="text-[10px] text-slate-400 font-mono shrink-0">{formatContext(m.context)} ctx</span>
              <span className="flex items-center gap-1 text-[10px] shrink-0">
                {m.via === 'direct' ? (
                  <Globe className="w-3 h-3 text-sky-400" title="Напрямую" />
                ) : (
                  <Shield className="w-3 h-3 text-violet-400" title="Через туннель" />
                )}
              </span>
              <span
                className={`flex items-center gap-1 text-[10px] font-medium ${health.cls} shrink-0 w-20 justify-end`}
                title={m.health}
              >
                {m.health === 'ok' ? (
                  <CheckCircle2 className="w-3 h-3" />
                ) : m.health === 'broken' ? (
                  <XCircle className="w-3 h-3" />
                ) : m.health === 'degraded' ? (
                  <Clock className="w-3 h-3" />
                ) : (
                  <Gauge className="w-3 h-3" />
                )}
                {health.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};