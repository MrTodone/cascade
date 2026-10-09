/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { AIModel, VlessNode, VpnStatus, RoutingState, RoutingProvider } from './types';
import { FALLBACK_FREE_MODELS } from './data/staticModels';
import { Header } from './components/Header';
import { StrategyBanner } from './components/StrategyBanner';
import { FilterBar } from './components/FilterBar';
import { ModelCard } from './components/ModelCard';
import { ConfigGeneratorModal } from './components/ConfigGeneratorModal';
import { CodePlayground } from './components/CodePlayground';
import { FreeProvidersGuide } from './components/FreeProvidersGuide';
import { VpnManagerModal } from './components/VpnManagerModal';
import { RoutingPanel } from './components/RoutingPanel';
import FirstRunWizard from './components/FirstRunWizard';
import { 
  Sparkles, 
  RefreshCw, 
  Terminal, 
  Layers, 
  ShieldCheck, 
  Cpu, 
  AlertCircle,
  Zap,
  CheckCircle2,
  SlidersHorizontal
} from 'lucide-react';

export default function App() {
  const [models, setModels] = useState<AIModel[]>(FALLBACK_FREE_MODELS);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sourcesStats, setSourcesStats] = useState({ openrouterCount: 0, totalFree: FALLBACK_FREE_MODELS.length });

  // First-run wizard gate (Task 37): hidden once the router has keys.
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/setup/status')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.needsSetup !== undefined) setNeedsSetup(!!d.needsSetup);
      })
      .catch(() => {});
  }, []);
  
  // Navigation & Modals
  const [activeTab, setActiveTab] = useState<'catalog' | 'playground' | 'strategy' | 'guide'>('catalog');
  const [isConfigModalOpen, setIsConfigModalOpen] = useState(false);
  const [isVpnModalOpen, setIsVpnModalOpen] = useState(false);
  const [testingModel, setTestingModel] = useState<AIModel | null>(null);

  // Built-in VPN & Anti-Censorship VLESS Relay State
  const [vpnStatus, setVpnStatus] = useState<VpnStatus>({
    enabled: true,
    activeNode: null,
    bestNode: null,
    totalNodes: 0,
    lastSync: new Date().toISOString(),
    nextSync: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    subscriptionUrl: '',
    ipLocation: '🇩🇪 Германия (Frankfurt am Main)',
    relayMode: 'vless-reality',
    autoBestEnabled: true,
    autoSyncEnabled: true,
    lastSpeedTest: new Date().toISOString(),
    nextSpeedTest: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    isBenchmarking: false,
    syncIntervalMinutes: 60,
    benchmarkIntervalMinutes: 10,
  });
  const [vpnNodes, setVpnNodes] = useState<VlessNode[]>([]);
  const [isSyncingVpn, setIsSyncingVpn] = useState(false);

  // Cascade chain selection
  const [cascadeModels, setCascadeModels] = useState<string[]>([
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'deepseek/deepseek-r1:free',
    'gemini-2.0-flash',
    'meta-llama/llama-3.3-70b-instruct:free',
  ]);

  // FAPMP routing (cascade panel): providers with connected keys by human name
  const [routingProviders, setRoutingProviders] = useState<Record<string, boolean>>({});

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('all');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [minScore, setMinScore] = useState(30);
  const [sortBy, setSortBy] = useState<'score' | 'context' | 'speed' | 'name'>('score');

  // Fetch parsed models from backend
  const fetchModels = async (forceRefresh = false) => {
    if (forceRefresh) setIsRefreshing(true);
    else setLoading(true);

    try {
      const res = await fetch(`/api/parse-models${forceRefresh ? '?refresh=true' : ''}`);
      const data = await res.json();
      if (data.success && data.models && data.models.length > 0) {
        setModels(data.models);
        setSourcesStats({
          openrouterCount: data.sources?.openrouterCount || 0,
          totalFree: data.models.length,
        });
        setLastUpdated(new Date(data.timestamp || Date.now()));
      }
    } catch (err) {
      console.error('Error fetching parsed models:', err);
      // Fallback data is already set initially
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  // Fetch built-in VPN & VLESS status
  const fetchVpnStatus = async () => {
    try {
      const res = await fetch('/api/vpn/status');
      const data = await res.json();
      if (data.success) {
        setVpnStatus({
          enabled: data.enabled,
          activeNode: data.activeNode,
          bestNode: data.bestNode,
          totalNodes: data.totalNodes,
          lastSync: data.lastSync,
          nextSync: data.nextSync,
          subscriptionUrl: data.subscriptionUrl,
          ipLocation: data.ipLocation,
          relayMode: data.relayMode,
          autoBestEnabled: data.autoBestEnabled,
          autoSyncEnabled: data.autoSyncEnabled,
          lastSpeedTest: data.lastSpeedTest,
          nextSpeedTest: data.nextSpeedTest,
          isBenchmarking: data.isBenchmarking,
          syncIntervalMinutes: data.syncIntervalMinutes || 60,
          benchmarkIntervalMinutes: data.benchmarkIntervalMinutes || 10,
        });
        if (data.nodes) {
          setVpnNodes(data.nodes);
        }
      }
    } catch (err) {
      console.error('Error fetching VPN status:', err);
    }
  };

  // Toggle built-in VPN
  const handleToggleVpn = async (targetState?: boolean) => {
    try {
      const newState = targetState !== undefined ? targetState : !vpnStatus.enabled;
      const res = await fetch('/api/vpn/toggle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
      const data = await res.json();
      if (data.success) {
        setVpnStatus((prev) => ({
          ...prev,
          enabled: data.enabled,
          relayMode: data.relayMode,
        }));
      }
    } catch (err) {
      console.error('Error toggling VPN:', err);
    }
  };

  // Select active VLESS node
  const handleSelectVpnNode = async (nodeId: string) => {
    try {
      const res = await fetch('/api/vpn/select-node', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      });
      const data = await res.json();
      if (data.success) {
        setVpnStatus((prev) => ({
          ...prev,
          activeNode: data.activeNode,
          ipLocation: data.ipLocation,
        }));
      }
    } catch (err) {
      console.error('Error selecting VPN node:', err);
    }
  };

  // Sync VPN nodes from the configured subscription
  const handleSyncVpn = async () => {
    setIsSyncingVpn(true);
    try {
      const res = await fetch('/api/vpn/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setVpnStatus({
          enabled: data.enabled,
          activeNode: data.activeNode,
          bestNode: data.bestNode,
          totalNodes: data.totalNodes,
          lastSync: data.lastSync,
          nextSync: data.nextSync,
          subscriptionUrl: data.subscriptionUrl,
          ipLocation: data.ipLocation,
          relayMode: data.relayMode,
          autoBestEnabled: data.autoBestEnabled,
          autoSyncEnabled: data.autoSyncEnabled,
          lastSpeedTest: data.lastSpeedTest,
          nextSpeedTest: data.nextSpeedTest,
          isBenchmarking: false,
          syncIntervalMinutes: data.syncIntervalMinutes || 60,
          benchmarkIntervalMinutes: data.benchmarkIntervalMinutes || 10,
        });
        if (data.nodes) {
          setVpnNodes(data.nodes);
        }
      }
    } catch (err) {
      console.error('Error syncing VPN:', err);
    } finally {
      setIsSyncingVpn(false);
    }
  };

  // Run full speed benchmark on all nodes and auto-select best
  const handleBenchmarkAll = async () => {
    setVpnStatus((prev) => ({ ...prev, isBenchmarking: true }));
    try {
      const res = await fetch('/api/vpn/benchmark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        setVpnStatus({
          enabled: data.enabled,
          activeNode: data.activeNode,
          bestNode: data.bestNode,
          totalNodes: data.totalNodes,
          lastSync: data.lastSync,
          nextSync: data.nextSync,
          subscriptionUrl: data.subscriptionUrl,
          ipLocation: data.ipLocation,
          relayMode: data.relayMode,
          autoBestEnabled: data.autoBestEnabled,
          autoSyncEnabled: data.autoSyncEnabled,
          lastSpeedTest: data.lastSpeedTest,
          nextSpeedTest: data.nextSpeedTest,
          isBenchmarking: false,
          syncIntervalMinutes: data.syncIntervalMinutes || 60,
          benchmarkIntervalMinutes: data.benchmarkIntervalMinutes || 10,
        });
        if (data.nodes) {
          setVpnNodes(data.nodes);
        }
      }
    } catch (err) {
      console.error('Error benchmarking VPN nodes:', err);
    } finally {
      setVpnStatus((prev) => ({ ...prev, isBenchmarking: false }));
    }
  };

  // Toggle Auto-Best mode
  const handleToggleAutoBest = async (targetState?: boolean) => {
    try {
      const newState = targetState !== undefined ? targetState : !vpnStatus.autoBestEnabled;
      const res = await fetch('/api/vpn/toggle-auto-best', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
      const data = await res.json();
      if (data.success) {
        setVpnStatus((prev) => ({
          ...prev,
          autoBestEnabled: data.autoBestEnabled,
          activeNode: data.activeNode,
          bestNode: data.bestNode,
          ipLocation: data.ipLocation,
        }));
        if (data.nodes) setVpnNodes(data.nodes);
      }
    } catch (err) {
      console.error('Error toggling auto-best:', err);
    }
  };

  // Update subscription URL
  const handleUpdateSubscriptionUrl = async (newUrl: string) => {
    setIsSyncingVpn(true);
    try {
      const res = await fetch('/api/vpn/subscription-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subscriptionUrl: newUrl }),
      });
      const data = await res.json();
      if (data.success) {
        setVpnStatus({
          enabled: data.enabled,
          activeNode: data.activeNode,
          bestNode: data.bestNode,
          totalNodes: data.totalNodes,
          lastSync: data.lastSync,
          nextSync: data.nextSync,
          subscriptionUrl: data.subscriptionUrl,
          ipLocation: data.ipLocation,
          relayMode: data.relayMode,
          autoBestEnabled: data.autoBestEnabled,
          autoSyncEnabled: data.autoSyncEnabled,
          lastSpeedTest: data.lastSpeedTest,
          nextSpeedTest: data.nextSpeedTest,
          isBenchmarking: false,
          syncIntervalMinutes: data.syncIntervalMinutes || 60,
          benchmarkIntervalMinutes: data.benchmarkIntervalMinutes || 10,
        });
        if (data.nodes) setVpnNodes(data.nodes);
      }
    } catch (err) {
      console.error('Error updating subscription URL:', err);
    } finally {
      setIsSyncingVpn(false);
    }
  };

  useEffect(() => {
    fetchModels();
    fetchVpnStatus();
  }, []);

  // Toggle model in cascade
  const handleToggleCascade = (modelId: string) => {
    setCascadeModels((prev) => {
      if (prev.includes(modelId)) {
        return prev.filter((m) => m !== modelId);
      } else {
        return [...prev, modelId];
      }
    });
  };

  const handleRemoveFromCascade = (modelId: string) => {
    setCascadeModels((prev) => prev.filter((m) => m !== modelId));
  };

  // Test model in playground
  const handleTestInPlayground = (model: AIModel) => {
    setTestingModel(model);
    setActiveTab('playground');
  };

  const handleRoutingStateChange = (state: RoutingState) => {
    setRoutingProviders(
      state.providers.reduce<Record<string, boolean>>((acc, p) => {
        acc[p.name] = !!p.hasApiKey;
        return acc;
      }, {})
    );
  };

  // Extract unique providers for filter
  const providersList = useMemo(() => {
    const list = Array.from(new Set(models.map((m) => m.provider)));
    return list.sort();
  }, [models]);

  // Filtered and sorted models
  const filteredModels = useMemo(() => {
    let result = [...models];

    // Search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (m) =>
          m.name.toLowerCase().includes(q) ||
          m.modelId.toLowerCase().includes(q) ||
          m.provider.toLowerCase().includes(q) ||
          m.architecture.toLowerCase().includes(q) ||
          m.description.toLowerCase().includes(q) ||
          m.specializations.some((s) => s.toLowerCase().includes(q))
      );
    }

    // Provider filter
    if (selectedProvider !== 'all') {
      result = result.filter((m) => m.provider === selectedProvider);
    }

    // Tag filter
    if (selectedTag === 'top_coder') {
      result = result.filter((m) => m.codingScore >= 95);
    } else if (selectedTag === 'reasoning') {
      result = result.filter(
        (m) =>
          m.modelId.includes('r1') ||
          m.name.toLowerCase().includes('reasoning') ||
          m.specializations.some((s) => s.toLowerCase().includes('reasoning') || s.toLowerCase().includes('cot'))
      );
    } else if (selectedTag === 'high_speed') {
      result = result.filter((m) => m.speedTokensSec >= 200);
    } else if (selectedTag === 'huge_context') {
      result = result.filter((m) => m.contextLength >= 64000);
    }

    // Min score
    result = result.filter((m) => m.codingScore >= minScore);

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'score') return b.codingScore - a.codingScore;
      if (sortBy === 'context') return b.contextLength - a.contextLength;
      if (sortBy === 'speed') return b.speedTokensSec - a.speedTokensSec;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return 0;
    });

    return result;
  }, [models, searchQuery, selectedProvider, selectedTag, minScore, sortBy]);

  if (needsSetup) {
    return <FirstRunWizard onDone={() => { setNeedsSetup(false); window.location.reload(); }} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* App Header */}
      <Header
        modelsCount={models.length}
        openRouterCount={sourcesStats.openrouterCount}
        isRefreshing={isRefreshing}
        onRefresh={() => fetchModels(true)}
        onOpenConfigModal={() => setIsConfigModalOpen(true)}
        onOpenGuideModal={() => setActiveTab('guide')}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        selectedCascadeCount={cascadeModels.length}
        vpnEnabled={vpnStatus.enabled}
        vpnActiveNode={vpnStatus.activeNode}
        autoBestEnabled={vpnStatus.autoBestEnabled}
        onToggleVpn={() => handleToggleVpn()}
        onOpenVpnModal={() => setIsVpnModalOpen(true)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Tab 1: Catalog */}
        {activeTab === 'catalog' && (
          <div className="space-y-6">
            {/* Strategy Banner */}
            <StrategyBanner
              onOpenConfig={() => setIsConfigModalOpen(true)}
              onOpenPlayground={() => setActiveTab('playground')}
            />

            {/* Cascade routing panel */}
            <RoutingPanel onStateChange={handleRoutingStateChange} />

            {/* Live Parser Stats Row */}
            <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-900/50 border border-slate-800/80 px-4 py-3 rounded-xl text-xs text-slate-400">
              <div className="flex items-center gap-2">
                <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>
                  Парсер активен: отобрано <strong className="text-white">{filteredModels.length}</strong> из{' '}
                  <strong className="text-white">{models.length}</strong> бесплатных моделей
                </span>
                {sourcesStats.openrouterCount > 0 && (
                  <span className="hidden sm:inline-block text-emerald-400 font-mono text-[11px]">
                    (Включая {sourcesStats.openrouterCount} из открытого пула OpenRouter API)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {lastUpdated && (
                  <span className="text-[11px] text-slate-500 font-mono">
                    Скан: {lastUpdated.toLocaleTimeString()}
                  </span>
                )}
                <button
                  onClick={() => setIsConfigModalOpen(true)}
                  className="text-emerald-400 hover:text-emerald-300 font-medium flex items-center gap-1"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>Каскад: {cascadeModels.length} выбрано</span>
                </button>
              </div>
            </div>

            {/* Filter Bar */}
            <FilterBar
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              selectedTag={selectedTag}
              setSelectedTag={setSelectedTag}
              selectedProvider={selectedProvider}
              setSelectedProvider={setSelectedProvider}
              minScore={minScore}
              setMinScore={setMinScore}
              sortBy={sortBy}
              setSortBy={setSortBy}
              providersList={providersList}
            />

            {/* Models Cards Grid */}
            {loading ? (
              <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
                <RefreshCw className="w-8 h-8 animate-spin text-emerald-400" />
                <p className="text-sm">Сканирование и парсинг доступных бесплатных моделей...</p>
              </div>
            ) : filteredModels.length === 0 ? (
              <div className="py-16 text-center border border-slate-800 rounded-2xl bg-slate-900/40 p-8 space-y-3">
                <AlertCircle className="w-8 h-8 text-slate-500 mx-auto" />
                <h3 className="text-base font-semibold text-slate-200">
                  По вашему запросу не найдено моделей
                </h3>
                <p className="text-xs text-slate-400 max-w-md mx-auto">
                  Попробуйте сбросить поисковый запрос, уменьшить минимальный балл или выбрать другого провайдера.
                </p>
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setSelectedTag('all');
                    setSelectedProvider('all');
                    setMinScore(30);
                  }}
                  className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium"
                >
                  Сбросить фильтры
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredModels.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    isInCascade={cascadeModels.includes(model.modelId)}
                    onToggleCascade={handleToggleCascade}
                    onTestInPlayground={handleTestInPlayground}
                    providerHasKey={routingProviders[model.provider] ?? false}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 2: Playground & Test */}
        {activeTab === 'playground' && (
          <CodePlayground
            models={models}
            selectedModel={testingModel}
            onSelectModel={setTestingModel}
            vpnStatus={vpnStatus}
            onToggleVpn={() => handleToggleVpn()}
            onOpenVpnModal={() => setIsVpnModalOpen(true)}
          />
        )}

        {/* Tab 3: Strategy */}
        {activeTab === 'strategy' && (
          <div className="space-y-6">
            <StrategyBanner
              onOpenConfig={() => setIsConfigModalOpen(true)}
              onOpenPlayground={() => setActiveTab('playground')}
            />

            {/* Deep Strategy Explanation */}
            <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 space-y-6">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <Cpu className="w-5 h-5 text-emerald-400" />
                Детальный разбор: Как работает бесконечный кодинг без бана по Rate Limit
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-slate-300">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="font-semibold text-sm text-emerald-400">1. Разделение ролей (Role Split)</div>
                  <p className="text-slate-400 leading-relaxed">
                    Никогда не используйте одну тяжелую модель для всего. 
                    Автодополнение строк (Tab) потребляет тысячи быстрых вызовов — отдайте его сверхскоростному Groq (450 tok/s). 
                    Сложный рефакторинг и архитектуру доверьте DeepSeek R1 или Qwen 2.5 Coder 32B.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="font-semibold text-sm text-teal-400">2. Ротация и каскадный Failover</div>
                  <p className="text-slate-400 leading-relaxed">
                    Бесплатные модели имеют ограничение (например, 20-30 запросов в минуту). 
                    Наш сгенерированный конфиг настраивает автоматический fallback: если первая модель ответила кодом 429, 
                    запрос без паузы уходит на вторую, третью и четвертую модель.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="font-semibold text-sm text-purple-400">3. Локальный тыл (Ollama)</div>
                  <p className="text-slate-400 leading-relaxed">
                    Модели уровня Qwen 2.5 Coder 7B или DeepSeek R1 8B легко запускаются на любом современном ноутбуке с 8-16 GB ОЗУ. 
                    Они служат 100% гарантией того, что ваш редактор кода никогда не зависнет и продолжит работать даже в самолете.
                  </p>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
                <span className="text-xs text-slate-400">
                  Готовы применить стратегию в своем редакторе?
                </span>
                <button
                  onClick={() => setIsConfigModalOpen(true)}
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-md transition-all flex items-center gap-2"
                >
                  <Terminal className="w-4 h-4" />
                  Сгенерировать каскадный конфиг
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Guide to Free Keys */}
        {activeTab === 'guide' && <FreeProvidersGuide />}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 text-xs text-slate-500 text-center">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">Cascade</span>
            <span>&bull;</span>
            <span>100% бесплатные открытые модели и провайдеры</span>
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <span>OpenRouter Free (:free)</span>
            <span>Groq LPU</span>
            <span>Google AI Studio 1M</span>
            <span>GitHub Models</span>
            <span>Ollama</span>
          </div>
        </div>
      </footer>

      {/* Config Generator Modal */}
      <ConfigGeneratorModal
        isOpen={isConfigModalOpen}
        onClose={() => setIsConfigModalOpen(false)}
        cascadeModels={cascadeModels}
        onRemoveModel={handleRemoveFromCascade}
      />

      {/* Built-in VPN & VLESS Anti-Censorship Manager Modal */}
      <VpnManagerModal
        isOpen={isVpnModalOpen}
        onClose={() => setIsVpnModalOpen(false)}
        vpnStatus={vpnStatus}
        nodes={vpnNodes}
        onToggleVpn={handleToggleVpn}
        onSelectNode={handleSelectVpnNode}
        onSyncNodes={handleSyncVpn}
        onBenchmarkAll={handleBenchmarkAll}
        onToggleAutoBest={handleToggleAutoBest}
        onUpdateSubscriptionUrl={handleUpdateSubscriptionUrl}
        isSyncing={isSyncingVpn}
      />
    </div>
  );
}
