import React from 'react';
import { 
  Terminal, 
  Cpu, 
  RefreshCw, 
  Zap, 
  ShieldCheck, 
  ShieldAlert,
  Download, 
  Code2,
  SlidersHorizontal
} from 'lucide-react';
import { VlessNode } from '../types';

interface HeaderProps {
  modelsCount: number;
  openRouterCount: number;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenConfigModal: () => void;
  onOpenGuideModal: () => void;
  activeTab: 'catalog' | 'playground' | 'strategy' | 'guide';
  setActiveTab: (tab: 'catalog' | 'playground' | 'strategy' | 'guide') => void;
  selectedCascadeCount: number;
  vpnEnabled: boolean;
  vpnActiveNode: VlessNode | null;
  autoBestEnabled?: boolean;
  onToggleVpn: () => void;
  onOpenVpnModal: () => void;
  onShutdown?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  modelsCount,
  openRouterCount,
  isRefreshing,
  onRefresh,
  onOpenConfigModal,
  onOpenGuideModal,
  activeTab,
  setActiveTab,
  selectedCascadeCount,
  vpnEnabled,
  vpnActiveNode,
  autoBestEnabled,
  onToggleVpn,
  onOpenVpnModal,
  onShutdown,
}) => {
  return (
    <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3.5 flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Brand & Parser Engine Status */}
        <div className="flex items-center gap-3.5 w-full md:w-auto">
          <div className="relative flex items-center justify-center w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 border border-emerald-500/30 text-emerald-400 shadow-lg shadow-emerald-950/40">
            <Terminal className="w-6 h-6" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Free AI Coder Parser
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono font-medium">
                  0$ / Бесплатно
                </span>
              </h1>
            </div>
            <p className="text-xs text-slate-400 flex items-center gap-2 mt-0.5">
              <span>Парсер 100% бесплатных моделей для безлимитного программирования</span>
              <span className="hidden sm:inline-block w-1 h-1 rounded-full bg-slate-600"></span>
              <span className="hidden sm:inline text-emerald-400 font-mono text-[11px]">
                {modelsCount} моделей ({openRouterCount} OpenRouter :free)
              </span>
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center bg-slate-900/90 p-1 rounded-xl border border-slate-800 text-xs font-medium w-full md:w-auto justify-center">
          <button
            id="tab-catalog-btn"
            onClick={() => setActiveTab('catalog')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'catalog'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            Каталог моделей ({modelsCount})
          </button>
          <button
            id="tab-playground-btn"
            onClick={() => setActiveTab('playground')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'playground'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Code2 className="w-3.5 h-3.5" />
            Песочница и Тест
          </button>
          <button
            id="tab-strategy-btn"
            onClick={() => setActiveTab('strategy')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'strategy'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            Стратегия каскада
          </button>
          <button
            id="tab-guide-btn"
            onClick={() => setActiveTab('guide')}
            className={`px-3.5 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${
              activeTab === 'guide'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            Бесплатные ключи (0$)
          </button>
        </div>

        {/* Action Buttons & Built-in VPN Toggle */}
        <div className="flex items-center gap-2.5 w-full md:w-auto justify-end flex-wrap sm:flex-nowrap">
          {/* Built-in VPN Toggle & Server Selector */}
          <div className="flex items-center gap-1 bg-slate-900/90 border border-slate-800 rounded-xl p-1 text-xs">
            <button
              id="vpn-quick-toggle-btn"
              type="button"
              onClick={onToggleVpn}
              className={`px-2.5 py-1 rounded-lg flex items-center gap-1.5 font-semibold transition-all ${
                vpnEnabled
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
              }`}
              title={vpnEnabled ? "Встроенный VPN включен (нажмите, чтобы выключить)" : "Встроенный VPN выключен (нажмите, чтобы включить)"}
            >
              {vpnEnabled ? (
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <ShieldAlert className="w-3.5 h-3.5 text-slate-500" />
              )}
              <span>VPN: {vpnEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
              {vpnEnabled && <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>}
            </button>

            <button
              id="vpn-manager-btn"
              type="button"
              onClick={onOpenVpnModal}
              className="px-2 py-1 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors flex items-center gap-1.5 font-mono text-[11px]"
              title="Открыть управление серверами VLESS Reality, авто-выбор лучшего и экспорт"
            >
              <span>{vpnActiveNode?.flag || '🌐'}</span>
              <span className="hidden xl:inline">{vpnActiveNode?.country || 'Германия'}</span>
              <span className="text-emerald-400 text-[10px] hidden sm:inline font-bold">{vpnActiveNode?.pingMs || 32}ms</span>
              {autoBestEnabled && (
                <span className="px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 text-[9px] font-mono hidden md:inline">
                  Auto-Best
                </span>
              )}
              <SlidersHorizontal className="w-3 h-3 text-slate-400" />
            </button>
          </div>

          <button
            id="refresh-parser-btn"
            onClick={onRefresh}
            disabled={isRefreshing}
            title="Обновить список моделей с серверов OpenRouter"
            className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-emerald-400' : ''}`} />
            <span className="hidden sm:inline">Сканировать</span>
          </button>

          <button
            id="open-config-btn"
            onClick={onOpenConfigModal}
            className="px-3.5 py-1.5 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-medium shadow-md shadow-emerald-950/50 flex items-center gap-2 transition-all"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Генератор конфигов</span>
            {selectedCascadeCount > 0 && (
              <span className="bg-emerald-900/90 text-emerald-200 px-1.5 py-0.2 rounded-full font-mono text-[10px] border border-emerald-400/40">
                {selectedCascadeCount}
              </span>
            )}
          </button>

          {onShutdown && (
            <button
              id="app-shutdown-btn"
              type="button"
              onClick={onShutdown}
              title="Остановить Cascade (фасад + роутер + туннель)"
              className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-red-950/60 border border-slate-700 hover:border-red-600/60 text-slate-300 hover:text-red-300 text-xs font-medium flex items-center gap-1.5 transition-all"
            >
              <span className="w-2.5 h-2.5 rounded-sm bg-red-500/80" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
};
