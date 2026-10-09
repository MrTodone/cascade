import React, { useState, useEffect, useMemo } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  RefreshCw, 
  Check, 
  Copy, 
  ExternalLink, 
  Download, 
  Zap, 
  Search, 
  Server, 
  Activity, 
  X,
  Globe,
  Radio,
  Lock,
  Cpu,
  Terminal,
  ChevronRight,
  Info,
  Clock,
  Award,
  ArrowUpDown,
  Flame,
  Settings,
  SlidersHorizontal,
  Wifi,
  WifiOff
} from 'lucide-react';
import { VlessNode, VpnStatus } from '../types';

interface VpnManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  vpnStatus: VpnStatus;
  nodes: VlessNode[];
  onToggleVpn: (enabled?: boolean) => Promise<void>;
  onSelectNode: (nodeId: string) => Promise<void>;
  onSyncNodes: () => Promise<void>;
  onBenchmarkAll?: () => Promise<void>;
  onToggleAutoBest?: (enabled?: boolean) => Promise<void>;
  onUpdateSubscriptionUrl?: (url: string) => Promise<void>;
  isSyncing: boolean;
}

export const VpnManagerModal: React.FC<VpnManagerModalProps> = ({
  isOpen,
  onClose,
  vpnStatus,
  nodes,
  onToggleVpn,
  onSelectNode,
  onSyncNodes,
  onBenchmarkAll,
  onToggleAutoBest,
  onUpdateSubscriptionUrl,
  isSyncing,
}) => {
  const [search, setSearch] = useState('');
  const [selectedCountry, setSelectedCountry] = useState('all');
  const [sortBy, setSortBy] = useState<'ping' | 'country' | 'default'>('ping');
  const [filterOnlineOnly, setFilterOnlineOnly] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [testingPingId, setTestingPingId] = useState<string | null>(null);
  const [pingMap, setPingMap] = useState<Record<string, { ping: number; online: boolean }>>({});
  const [activeTab, setActiveTab] = useState<'servers' | 'client_config' | 'guide' | 'settings'>('servers');
  const [downloadingFormat, setDownloadingFormat] = useState<string | null>(null);
  const [isLocalBenchmarking, setIsLocalBenchmarking] = useState(false);
  
  // Custom subscription URL editing
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [customSubUrl, setCustomSubUrl] = useState(vpnStatus.subscriptionUrl || '');

  useEffect(() => {
    setCustomSubUrl(vpnStatus.subscriptionUrl || '');
  }, [vpnStatus.subscriptionUrl]);

  // Extract unique countries
  const countries = useMemo(() => {
    const map = new Map<string, { country: string; flag: string; count: number }>();
    nodes.forEach(n => {
      const existing = map.get(n.country);
      if (existing) {
        existing.count++;
      } else {
        map.set(n.country, { country: n.country, flag: n.flag, count: 1 });
      }
    });
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [nodes]);

  // Filter and sort nodes
  const processedNodes = useMemo(() => {
    let result = nodes.filter(n => {
      const matchesCountry = selectedCountry === 'all' || n.country === selectedCountry;
      const q = search.toLowerCase().trim();
      const matchesSearch = !q || 
        n.name.toLowerCase().includes(q) || 
        n.host.toLowerCase().includes(q) || 
        n.country.toLowerCase().includes(q) || 
        n.sni.toLowerCase().includes(q);
      
      const localPing = pingMap[n.id];
      const isOnline = localPing !== undefined ? localPing.online : (n.isOnline !== undefined ? n.isOnline : true);
      const matchesOnline = !filterOnlineOnly || isOnline;

      return matchesCountry && matchesSearch && matchesOnline;
    });

    if (sortBy === 'ping') {
      result.sort((a, b) => {
        const pingA = pingMap[a.id]?.ping ?? a.pingMs ?? 9999;
        const pingB = pingMap[b.id]?.ping ?? b.pingMs ?? 9999;
        return pingA - pingB;
      });
    } else if (sortBy === 'country') {
      result.sort((a, b) => a.country.localeCompare(b.country, 'ru'));
    }

    return result;
  }, [nodes, selectedCountry, search, filterOnlineOnly, sortBy, pingMap]);

  if (!isOpen) return null;

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleTestPing = async (nodeId: string) => {
    setTestingPingId(nodeId);
    try {
      const res = await fetch('/api/vpn/test-ping', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodeId }),
      });
      const data = await res.json();
      if (data.success) {
        setPingMap(prev => ({ 
          ...prev, 
          [nodeId]: { ping: data.pingMs, online: data.isOnline } 
        }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setTestingPingId(null);
    }
  };

  const handleRunFullBenchmark = async () => {
    setIsLocalBenchmarking(true);
    try {
      if (onBenchmarkAll) {
        await onBenchmarkAll();
      } else {
        const res = await fetch('/api/vpn/benchmark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        await res.json();
      }
    } catch (err) {
      console.error('Benchmark failed:', err);
    } finally {
      setIsLocalBenchmarking(false);
    }
  };

  const handleSaveSubUrl = async () => {
    if (!customSubUrl.trim()) return;
    if (onUpdateSubscriptionUrl) {
      await onUpdateSubscriptionUrl(customSubUrl.trim());
      setIsEditingUrl(false);
    }
  };

  const handleExport = async (format: 'sing-box' | 'xray' | 'raw') => {
    setDownloadingFormat(format);
    try {
      const res = await fetch(`/api/vpn/export?format=${format}`);
      if (format === 'raw') {
        const text = await res.text();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'vless-nodes-russia-unblock.txt';
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const json = await res.json();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${format}-config.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDownloadingFormat(null);
    }
  };

  // Helper to compute minutes until next hourly sync
  const getMinutesUntilNextSync = () => {
    if (!vpnStatus.nextSync) return 60;
    const diffMs = new Date(vpnStatus.nextSync).getTime() - Date.now();
    return Math.max(1, Math.round(diffMs / 60000));
  };

  // Helper to format last sync
  const formatTime = (isoString?: string) => {
    if (!isoString) return 'Только что';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch (e) {
      return 'Недавно';
    }
  };

  const activeNode = vpnStatus.activeNode;
  const bestNode = vpnStatus.bestNode || nodes.find(n => n.isBest) || nodes[0];
  const isBenchmarking = isLocalBenchmarking || vpnStatus.isBenchmarking;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto">
      <div 
        className="bg-slate-900 border border-slate-800 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/80">
          <div className="flex items-center gap-3">
            <div className={`p-2.5 rounded-xl border ${vpnStatus.enabled ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-400 shadow-lg shadow-emerald-950/50' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>
              {vpnStatus.enabled ? <ShieldCheck className="w-6 h-6" /> : <ShieldAlert className="w-6 h-6" />}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold text-white">Встроенный VPN & Anti-Censorship Relay</h2>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-mono font-semibold border ${
                  vpnStatus.enabled 
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' 
                    : 'bg-rose-500/20 text-rose-300 border-rose-500/30'
                }`}>
                  {vpnStatus.enabled ? 'АКТИВЕН' : 'ОТКЛЮЧЕН'}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 font-mono flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emerald-400" />
                  Каждый час
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-950/60 text-amber-300 border border-amber-500/40 font-mono flex items-center gap-1">
                  <Award className="w-3 h-3 text-amber-400" />
                  Auto-Best: {vpnStatus.autoBestEnabled ? 'ВКЛ' : 'ВЫКЛ'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Автоматическое часовое обновление подписки и динамический выбор самого быстрого узла
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Real-time Automation & Auto-Best Control Center Banner */}
        <div className="p-4 sm:p-5 border-b bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-slate-800 space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            
            {/* Card 1: Hourly subscription auto-sync status */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  Автообновление подписки
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30">
                  Каждые 60 мин
                </span>
              </div>
              <div className="text-[11px] text-slate-400 space-y-0.5 font-mono">
                <div>Последнее: <span className="text-slate-200 font-semibold">{formatTime(vpnStatus.lastSync)}</span></div>
                <div>Следующее: <span className="text-cyan-300 font-semibold">через ~{getMinutesUntilNextSync()} мин</span></div>
              </div>
              <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-800/80">
                <span
                  className="text-[10px] text-slate-400 truncate max-w-[130px]"
                  title="URL подписки задаётся в конфиге (vpn.subscriptionUrl)"
                >
                  {vpnStatus.subscriptionUrl ? `Подписка (${nodes.length} нод)` : "Подписка не настроена"}
                </span>
                <button
                  onClick={onSyncNodes}
                  disabled={isSyncing}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium flex items-center gap-1 transition-all border border-slate-700 disabled:opacity-50"
                  title="Запустить немедленное обновление подписки"
                >
                  <RefreshCw className={`w-3 h-3 ${isSyncing ? 'animate-spin text-cyan-400' : ''}`} />
                  <span>{isSyncing ? 'Загрузка...' : 'Обновить'}</span>
                </button>
              </div>
            </div>

            {/* Card 2: Auto-Best Selection Engine */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-amber-500/30 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <Award className="w-3.5 h-3.5 text-amber-400" />
                  Авто-выбор лучшего (Auto-Best)
                </span>
                {onToggleAutoBest && (
                  <button
                    onClick={() => onToggleAutoBest()}
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-semibold border transition-all ${
                      vpnStatus.autoBestEnabled 
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' 
                        : 'bg-slate-800 text-slate-400 border-slate-700'
                    }`}
                  >
                    {vpnStatus.autoBestEnabled ? 'АКТИВЕН' : 'ОТКЛЮЧЕН'}
                  </button>
                )}
              </div>
              <div className="text-[11px] text-slate-400 space-y-0.5">
                <div className="flex items-center gap-1 truncate text-slate-200 font-medium">
                  <span>Топ-1:</span>
                  <span className="text-base">{bestNode?.flag}</span>
                  <span className="truncate">{bestNode?.country} ({bestNode?.host})</span>
                </div>
                <div className="font-mono text-[10px] text-amber-300 flex items-center gap-1.5">
                  <Zap className="w-3 h-3 text-amber-400" />
                  <span>Минимальный пинг: <strong>{bestNode?.pingMs || 32} ms</strong></span>
                  <span className="px-1 py-0.2 rounded bg-amber-950 text-amber-300 text-[9px] uppercase font-bold">
                    {bestNode?.speedRating || 'ULTRA'}
                  </span>
                </div>
              </div>
              <div className="text-[10px] text-slate-400 mt-2 pt-2 border-t border-slate-800/80">
                {vpnStatus.autoBestEnabled 
                  ? 'Автоматически переключает релей на узел с наименьшим откликом' 
                  : 'Ручной выбор узла зафиксирован пользователем'}
              </div>
            </div>

            {/* Card 3: Speed Benchmark & Master Toggle */}
            <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                  <Activity className="w-3.5 h-3.5 text-emerald-400" />
                  Тестирование скорости
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {formatTime(vpnStatus.lastSpeedTest)}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Проверяет реальный TCP/TLS сокет-отклик всех серверов и обновляет рейтинг задержки.
              </p>
              <div className="flex items-center gap-2 mt-2 pt-2 border-t border-slate-800/80">
                <button
                  onClick={handleRunFullBenchmark}
                  disabled={isBenchmarking}
                  className="w-full px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-950/50 disabled:opacity-50"
                >
                  <Zap className={`w-3.5 h-3.5 ${isBenchmarking ? 'animate-spin' : ''}`} />
                  <span>{isBenchmarking ? 'Тестирование серверов...' : 'Проверить скорость всех'}</span>
                </button>
              </div>
            </div>

          </div>

          {/* Master VPN Switch */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onToggleVpn()}
                className={`relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                  vpnStatus.enabled ? 'bg-emerald-500' : 'bg-slate-700'
                }`}
              >
                <span
                  className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                    vpnStatus.enabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
              <div>
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <span>Статус встроенного VPN:</span>
                  <span className={vpnStatus.enabled ? 'text-emerald-400' : 'text-slate-400'}>
                    {vpnStatus.enabled ? 'ВКЛЮЧЕН (Обход активен)' : 'ВЫКЛЮЧЕН (Прямое подключение)'}
                  </span>
                </span>
                <span className="text-[11px] text-slate-400 block">
                  {vpnStatus.enabled ? (
                    <span className="text-emerald-300">
                      Активный узел: {activeNode?.flag} {activeNode?.country} ({activeNode?.host}) &bull; Задержка: ~{activeNode?.pingMs || 35}ms
                    </span>
                  ) : (
                    'Запросы к ИИ направляются напрямую. Если провайдер заблокирован в РФ, API вернет ошибку 403.'
                  )}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <span className="text-[11px] text-slate-400">
                Всего серверов в пуле: <strong className="text-white font-mono">{nodes.length}</strong>
              </span>
            </div>
          </div>
        </div>

        {/* Modal Navigation Tabs */}
        <div className="flex border-b border-slate-800 bg-slate-950 px-4 pt-2 gap-2 text-xs font-medium">
          <button
            onClick={() => setActiveTab('servers')}
            className={`px-4 py-2 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'servers'
                ? 'border-emerald-500 text-emerald-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Server className="w-4 h-4" />
            <span>Серверы VLESS Reality ({nodes.length})</span>
          </button>
          <button
            onClick={() => setActiveTab('client_config')}
            className={`px-4 py-2 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'client_config'
                ? 'border-emerald-500 text-emerald-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-4 h-4" />
            <span>Экспорт конфигов (Sing-box, Xray, Hiddify)</span>
          </button>
          <button
            onClick={() => setActiveTab('guide')}
            className={`px-4 py-2 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'guide'
                ? 'border-emerald-500 text-emerald-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Terminal className="w-4 h-4" />
            <span>Инструкция для OpenCode & IDE</span>
          </button>
          <button
            onClick={() => setActiveTab('settings')}
            className={`px-4 py-2 border-b-2 transition-all flex items-center gap-2 ${
              activeTab === 'settings'
                ? 'border-emerald-500 text-emerald-300 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Настройка подписки</span>
          </button>
        </div>

        {/* Tab 1: Server List with Auto-Best Ranking */}
        {activeTab === 'servers' && (
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1">
            {/* Search, Sort and Filter Bar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
              <div className="relative w-full sm:w-72">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type="text"
                  placeholder="Поиск по серверу, хосту, SNI..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                {/* Sort selector */}
                <div className="flex items-center gap-1.5 bg-slate-950 p-1 rounded-xl border border-slate-800 text-xs">
                  <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 ml-1.5" />
                  <button
                    onClick={() => setSortBy('ping')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      sortBy === 'ping' 
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚡ По скорости (пинг)
                  </button>
                  <button
                    onClick={() => setSortBy('country')}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      sortBy === 'country' 
                        ? 'bg-emerald-500/20 text-emerald-300 font-bold' 
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🌍 По странам
                  </button>
                </div>

                {/* Filter online only */}
                <button
                  onClick={() => setFilterOnlineOnly(!filterOnlineOnly)}
                  className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border flex items-center gap-1.5 transition-all ${
                    filterOnlineOnly 
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40' 
                      : 'bg-slate-950 text-slate-400 border-slate-800 hover:bg-slate-800'
                  }`}
                >
                  <Wifi className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Только онлайн</span>
                </button>
              </div>
            </div>

            {/* Country filter chips */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
              <button
                onClick={() => setSelectedCountry('all')}
                className={`px-3 py-1 rounded-lg border transition-all whitespace-nowrap ${
                  selectedCountry === 'all'
                    ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                }`}
              >
                Все локации ({nodes.length})
              </button>
              {countries.map(c => (
                <button
                  key={c.country}
                  onClick={() => setSelectedCountry(c.country)}
                  className={`px-2.5 py-1 rounded-lg border transition-all whitespace-nowrap flex items-center gap-1.5 ${
                    selectedCountry === c.country
                      ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300 font-semibold'
                      : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <span>{c.flag}</span>
                  <span>{c.country}</span>
                  <span className="text-[10px] text-slate-500 font-mono">({c.count})</span>
                </button>
              ))}
            </div>

            {/* Nodes list */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {processedNodes.map((node, index) => {
                const isActive = activeNode?.id === node.id;
                const localInfo = pingMap[node.id];
                const currentPing = localInfo?.ping ?? node.pingMs ?? 42;
                const isOnline = localInfo?.online ?? (node.isOnline !== undefined ? node.isOnline : true);
                const isBest = node.isBest || (index === 0 && sortBy === 'ping' && isOnline);

                let pingColor = 'text-emerald-400';
                let pingBg = 'bg-emerald-500/10 border-emerald-500/30';
                let speedLabel = 'Отличный';

                if (!isOnline) {
                  pingColor = 'text-rose-400';
                  pingBg = 'bg-rose-500/10 border-rose-500/30';
                  speedLabel = 'Офлайн';
                } else if (currentPing < 45) {
                  pingColor = 'text-emerald-300';
                  pingBg = 'bg-emerald-500/20 border-emerald-500/40';
                  speedLabel = '⚡ Ультра';
                } else if (currentPing < 90) {
                  pingColor = 'text-teal-300';
                  pingBg = 'bg-teal-500/10 border-teal-500/30';
                  speedLabel = 'Быстрый';
                } else if (currentPing < 160) {
                  pingColor = 'text-amber-300';
                  pingBg = 'bg-amber-500/10 border-amber-500/30';
                  speedLabel = 'Нормальный';
                } else {
                  pingColor = 'text-rose-300';
                  pingBg = 'bg-rose-500/10 border-rose-500/30';
                  speedLabel = 'Медленный';
                }

                return (
                  <div
                    key={node.id}
                    className={`p-3.5 rounded-xl border transition-all relative ${
                      isBest
                        ? 'bg-gradient-to-br from-amber-950/20 via-slate-950 to-slate-950 border-amber-500/50 ring-1 ring-amber-500/40 shadow-lg shadow-amber-950/20'
                        : isActive
                        ? 'bg-slate-950/90 border-emerald-500/50 shadow-md shadow-emerald-950/30 ring-1 ring-emerald-500/40'
                        : 'bg-slate-950/60 border-slate-800/80 hover:border-slate-700 hover:bg-slate-950'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{node.flag}</span>
                        <div>
                          <div className="text-xs font-bold text-white flex items-center gap-1.5 flex-wrap">
                            <span className="truncate max-w-[190px]" title={node.name}>{node.name}</span>
                            {isBest && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold flex items-center gap-0.5">
                                <Award className="w-2.5 h-2.5 text-amber-400" />
                                ТОП-1 СКОРОСТЬ
                              </span>
                            )}
                            {isActive && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-mono">
                                АКТИВЕН
                              </span>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-400 font-mono">{node.country}</span>
                        </div>
                      </div>

                      {/* Ping badge with direct test button */}
                      <button
                        onClick={() => handleTestPing(node.id)}
                        disabled={testingPingId === node.id}
                        title="Кликните для перепроверки задержки до этого сервера"
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-lg border text-xs font-mono transition-all ${pingBg} hover:opacity-80`}
                      >
                        <Activity className={`w-3 h-3 ${testingPingId === node.id ? 'animate-spin text-emerald-400' : pingColor}`} />
                        <span className={`font-bold ${pingColor}`}>
                          {testingPingId === node.id ? '...' : (!isOnline ? 'Офлайн' : `${currentPing} ms`)}
                        </span>
                      </button>
                    </div>

                    {/* Server technical details */}
                    <div className="grid grid-cols-2 gap-1.5 text-[11px] font-mono bg-slate-900/60 p-2 rounded-lg border border-slate-800/60 mb-3 text-slate-400">
                      <div className="truncate">
                        <span className="text-slate-500">Хост: </span>
                        <span className="text-slate-300">{node.host}:{node.port}</span>
                      </div>
                      <div className="truncate">
                        <span className="text-slate-500">SNI: </span>
                        <span className="text-slate-300">{node.sni}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Протокол: </span>
                        <span className="text-emerald-400 font-semibold">{node.security.toUpperCase()}</span>
                      </div>
                      <div>
                        <span className="text-slate-500">Рейтинг: </span>
                        <span className={`font-semibold ${pingColor}`}>{speedLabel}</span>
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/60">
                      <button
                        onClick={() => handleCopy(node.rawUrl, node.id)}
                        className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-800 transition-colors"
                        title="Скопировать строку vless://..."
                      >
                        {copiedId === node.id ? (
                          <>
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                            <span className="text-emerald-400">Скопировано!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="w-3.5 h-3.5" />
                            <span>VLESS ссылка</span>
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => onSelectNode(node.id)}
                        disabled={isActive}
                        className={`text-xs px-3 py-1 rounded-lg font-semibold transition-all ${
                          isActive
                            ? 'bg-emerald-500/20 text-emerald-300 cursor-default border border-emerald-500/30'
                            : 'bg-slate-800 hover:bg-emerald-600 text-slate-300 hover:text-white border border-slate-700 hover:border-emerald-500'
                        }`}
                      >
                        {isActive ? 'Шлюз подключен' : 'Использовать этот'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tab 2: Client Config Export */}
        {activeTab === 'client_config' && (
          <div className="p-4 sm:p-6 overflow-y-auto space-y-5 flex-1">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Download className="w-4 h-4 text-emerald-400" />
                Готовые клиенты для Windows, macOS, Linux, iOS и Android
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Вы можете использовать эти VLESS Reality серверы в любых современных клиентах обхода блокировок. 
                Рекомендуемые бесплатные программы без рекламы:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mt-3 text-xs">
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="font-bold text-emerald-300">Hiddify Next</div>
                  <div className="text-[11px] text-slate-400">Windows, Mac, Linux, Android, iOS</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="font-bold text-teal-300">v2rayN / sing-box</div>
                  <div className="text-[11px] text-slate-400">Windows / Linux CLI</div>
                </div>
                <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800">
                  <div className="font-bold text-cyan-300">FoXray / Streisand</div>
                  <div className="text-[11px] text-slate-400">iOS, iPadOS, macOS</div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Скачать сгенерированные файлы конфигураций:
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="font-bold text-sm text-white">Конфиг Sing-box</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Формат JSON с входящим портом 10808 (Mixed: SOCKS5 & HTTP)
                    </div>
                  </div>
                  <button
                    onClick={() => handleExport('sing-box')}
                    disabled={downloadingFormat === 'sing-box'}
                    className="w-full py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-emerald-950/40"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать sing-box.json</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="font-bold text-sm text-white">Конфиг Xray Core</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Формат JSON с портами 10808 (Socks) и 10809 (HTTP)
                    </div>
                  </div>
                  <button
                    onClick={() => handleExport('xray')}
                    disabled={downloadingFormat === 'xray'}
                    className="w-full py-2 px-3 rounded-lg bg-teal-600 hover:bg-teal-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-all shadow-md shadow-teal-950/40"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать xray.json</span>
                  </button>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between space-y-3">
                  <div>
                    <div className="font-bold text-sm text-white">Все VLESS ссылки (TXT)</div>
                    <div className="text-xs text-slate-400 mt-1">
                      Полный список всех {nodes.length} конфигураций vless:// для импорта
                    </div>
                  </div>
                  <button
                    onClick={() => handleExport('raw')}
                    disabled={downloadingFormat === 'raw'}
                    className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center justify-center gap-1.5 transition-all border border-slate-700"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Скачать vless-list.txt</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: OpenCode & IDE Guide */}
        {activeTab === 'guide' && (
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 text-xs">
            <div className="p-4 rounded-xl bg-slate-950 border border-emerald-500/30">
              <h3 className="text-sm font-bold text-white mb-1 flex items-center gap-2">
                <Terminal className="w-4 h-4 text-emerald-400" />
                Раздельное туннелирование: быстрый запуск без общего VPN
              </h3>
              <p className="text-slate-300 leading-relaxed">
                Чтобы не замедлять игры, фильмы и локальные сайты общим VPN, запустите локальный клиент (Sing-box / Hiddify / v2rayN) на порту <strong>10808</strong>, и направьте в него только запросы ИИ-кодинга.
              </p>
            </div>

            <div className="space-y-3">
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="font-bold text-emerald-300 mb-1 flex items-center gap-1.5">
                  <span>1. OpenCode AI CLI</span>
                </div>
                <p className="text-slate-400 mb-2">
                  Запускайте автономного агента OpenCode в терминале через локальный прокси:
                </p>
                <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800 font-mono text-emerald-400 text-xs">
                  <code>ALL_PROXY=socks5://127.0.0.1:10808 opencode</code>
                  <button 
                    onClick={() => handleCopy('ALL_PROXY=socks5://127.0.0.1:10808 opencode', 'copy_cmd_opencode')}
                    className="p-1 hover:text-white text-slate-400"
                  >
                    {copiedId === 'copy_cmd_opencode' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="font-bold text-teal-300 mb-1 flex items-center gap-1.5">
                  <span>2. VS Code / Continue / Cline / Cursor</span>
                </div>
                <p className="text-slate-400 mb-2">
                  Откройте настройки VS Code (<code className="text-slate-300">settings.json</code>) и добавьте прокси:
                </p>
                <div className="bg-slate-900 p-2.5 rounded-lg border border-slate-800 font-mono text-slate-300 text-xs">
                  <pre className="text-emerald-400">
{`"http.proxy": "http://127.0.0.1:10808",
"http.proxyStrictSSL": false`}
                  </pre>
                </div>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800">
                <div className="font-bold text-cyan-300 mb-1 flex items-center gap-1.5">
                  <span>3. Aider & Python скрипты</span>
                </div>
                <p className="text-slate-400 mb-2">
                  Экспортируйте системные переменные окружения в сессии терминала:
                </p>
                <div className="flex items-center justify-between bg-slate-900 p-2.5 rounded-lg border border-slate-800 font-mono text-emerald-400 text-xs">
                  <code>export HTTP_PROXY="http://127.0.0.1:10808" HTTPS_PROXY="http://127.0.0.1:10808"</code>
                  <button 
                    onClick={() => handleCopy('export HTTP_PROXY="http://127.0.0.1:10808" HTTPS_PROXY="http://127.0.0.1:10808"', 'copy_cmd_env')}
                    className="p-1 hover:text-white text-slate-400"
                  >
                    {copiedId === 'copy_cmd_env' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 4: Subscription Settings */}
        {activeTab === 'settings' && (
          <div className="p-4 sm:p-6 overflow-y-auto space-y-4 flex-1 text-xs">
            <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Settings className="w-4 h-4 text-cyan-400" />
                Источник подписки VLESS серверов
              </h3>
              <p className="text-slate-400 leading-relaxed">
                Сервис автоматически раз в 1 час (каждые 3600 сек) перечитывает подписку, парсит актуальные ссылки с протоколом <code className="text-emerald-400">vless://...</code>, проверяет сокет-задержку и переключает релей на самый быстрый сервер.
              </p>

              <div className="space-y-2 pt-2">
                <label className="text-slate-300 font-semibold block">
                  URL подписки (текстовый файл со строками vless://):
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    value={customSubUrl}
                    onChange={(e) => setCustomSubUrl(e.target.value)}
                    placeholder="https://..."
                    className="flex-1 px-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs text-white font-mono focus:outline-none focus:border-cyan-500"
                  />
                  <button
                    onClick={handleSaveSubUrl}
                    disabled={isSyncing || !customSubUrl.trim()}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-semibold transition-all shadow-md shadow-cyan-950/40 disabled:opacity-50 shrink-0"
                  >
                    {isSyncing ? 'Проверка...' : 'Сохранить и загрузить'}
                  </button>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
                <div className="font-semibold text-slate-300">Источник подписки:</div>
                <div>
                  URL задаётся ТОЛЬКО в конфиге (<code className="text-cyan-400">vpn.subscriptionUrl</code>) или в поле выше. Пусто = ретранслятор выключен (graceful). В коде и примерах URL отсутствует.
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
};
