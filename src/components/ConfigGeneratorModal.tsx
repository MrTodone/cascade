import React, { useState, useEffect } from 'react';
import { ConfigTool } from '../types';
import { 
  X, 
  Copy, 
  Check, 
  Download, 
  Terminal, 
  Cpu, 
  Layers, 
  FileCode, 
  Info, 
  Zap, 
  ShieldCheck,
  ExternalLink,
  Sparkles,
  Bot
} from 'lucide-react';

interface ConfigGeneratorModalProps {
  isOpen: boolean;
  onClose: () => void;
  cascadeModels: string[];
  onRemoveModel: (modelId: string) => void;
}

export const ConfigGeneratorModal: React.FC<ConfigGeneratorModalProps> = ({
  isOpen,
  onClose,
  cascadeModels,
  onRemoveModel,
}) => {
  const [activeTool, setActiveTool] = useState<ConfigTool>('continue');
  const [openRouterKey, setOpenRouterKey] = useState('sk-or-v1-YOUR_FREE_KEY');
  const [groqKey, setGroqKey] = useState('gsk_YOUR_GROQ_KEY');
  const [generatedConfig, setGeneratedConfig] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Fetch or generate config
  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/generate-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tool: activeTool,
          selectedModels: cascadeModels,
          openRouterKey,
          groqKey,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setGeneratedConfig(data);
      }
    } catch (err) {
      console.error('Failed to generate config:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchConfig();
    }
  }, [isOpen, activeTool, cascadeModels, openRouterKey, groqKey]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (generatedConfig?.configContent) {
      navigator.clipboard.writeText(generatedConfig.configContent);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownload = () => {
    if (!generatedConfig) return;
    const blob = new Blob([generatedConfig.configContent], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = generatedConfig.fileName || 'config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="relative w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Terminal className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Генератор каскадных конфигов для IDE
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-medium">
                  Zero-Limit Cascade
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Создайте готовый файл конфигурации для авто-ротации бесплатных ИИ моделей
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 overflow-y-auto space-y-5">
          {/* Tool selector tabs */}
          <div>
            <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
              Выберите среду разработки или инструмент:
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
              {[
                { id: 'opencode', label: 'OpenCode (Agent)', icon: Bot, badge: 'CLI & TUI' },
                { id: 'continue', label: 'VS Code (Continue)', icon: FileCode },
                { id: 'cline', label: 'Cline / Roo Code', icon: Cpu },
                { id: 'cursor', label: 'Cursor IDE', icon: Zap },
                { id: 'aider', label: 'Aider CLI', icon: Terminal },
                { id: 'cascade_proxy', label: 'Cascade Proxy (Py)', icon: Layers },
              ].map((item) => {
                const Icon = item.icon;
                const isSelected = activeTool === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => setActiveTool(item.id as ConfigTool)}
                    className={`p-2.5 rounded-xl border text-xs font-semibold flex flex-col items-center text-center gap-1.5 transition-all relative ${
                      isSelected
                        ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-sm'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:bg-slate-800/80 hover:text-slate-200'
                    }`}
                  >
                    {item.badge && (
                      <span className="absolute -top-1.5 right-1 px-1.5 py-0.2 rounded text-[9px] font-mono bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        {item.badge}
                      </span>
                    )}
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Cascade Models in Chain */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                Цепочка ротации моделей ({cascadeModels.length}):
              </label>
              <span className="text-[11px] text-slate-500">
                (При 429 Rate Limit запрос мгновенно перейдет к следующей)
              </span>
            </div>

            <div className="flex flex-wrap gap-2 p-3 rounded-xl bg-slate-950 border border-slate-800">
              {cascadeModels.length === 0 ? (
                <div className="text-xs text-slate-500 italic py-1">
                  Нет выбранных моделей. Добавьте модели из каталога кнопкой "В каскад".
                </div>
              ) : (
                cascadeModels.map((m, idx) => (
                  <span
                    key={m}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono bg-slate-900 border border-slate-700 text-slate-300"
                  >
                    <span className="text-emerald-400 font-bold text-[10px]">#{idx + 1}</span>
                    <span className="truncate max-w-[240px]">{m}</span>
                    <button
                      onClick={() => onRemoveModel(m)}
                      className="hover:text-red-400 text-slate-500 transition-colors ml-1"
                    >
                      &times;
                    </button>
                  </span>
                ))
              )}
            </div>
          </div>

          {/* Optional API Keys Input */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <div>
              <label className="text-[11px] text-slate-400 font-medium block mb-1">
                OpenRouter Free API Key (Необязательно):
              </label>
              <input
                type="text"
                value={openRouterKey}
                onChange={(e) => setOpenRouterKey(e.target.value)}
                placeholder="sk-or-v1-..."
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 font-medium block mb-1">
                Groq Free API Key (Для быстрого таб-автокомплита):
              </label>
              <input
                type="text"
                value={groqKey}
                onChange={(e) => setGroqKey(e.target.value)}
                placeholder="gsk_..."
                className="w-full px-3 py-1.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 font-mono focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          {/* Instructions Box */}
          {generatedConfig?.instructions && (
            <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300 flex items-start gap-2">
              <Info className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <span className="font-semibold">Куда положить: </span>
                <span className="text-emerald-200/90">{generatedConfig.instructions}</span>
              </div>
            </div>
          )}

          {/* OpenCode Specific Quick-Start Helper */}
          {activeTool === 'opencode' && (
            <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-white flex items-center gap-1.5">
                  <Bot className="w-3.5 h-3.5 text-emerald-400" />
                  Быстрый запуск OpenCode в терминале:
                </span>
                <a
                  href="https://opencode.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                >
                  <span>Документация opencode.ai</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block mb-0.5 font-sans">1. Установка CLI (глобально):</span>
                  <span className="text-emerald-400 select-all">npm i -g opencode-ai</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-500 block mb-0.5 font-sans">2. Запуск в проекте (интерактивный агент):</span>
                  <span className="text-emerald-400 select-all">opencode</span>
                </div>
              </div>
              <p className="text-[11px] text-slate-400">
                В корне этого проекта уже создан файл <code className="text-emerald-300 font-mono">opencode.json</code>. После установки вы можете сразу запустить <code className="text-emerald-300 font-mono">opencode</code> прямо здесь!
              </p>
            </div>
          )}

          {/* Generated Code Output Preview */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-slate-400">
                Файл: <strong className="text-slate-200">{generatedConfig?.fileName}</strong>
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-all"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Скопировано!' : 'Копировать'}</span>
                </button>
                <button
                  onClick={handleDownload}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium flex items-center gap-1.5 transition-all"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Скачать {generatedConfig?.fileName}</span>
                </button>
              </div>
            </div>

            <div className="relative rounded-xl border border-slate-800 bg-slate-950 p-4 max-h-72 overflow-y-auto font-mono text-xs text-slate-300">
              <pre className="whitespace-pre-wrap">{generatedConfig?.configContent || '// Генерация...'}</pre>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <span className="text-xs text-slate-500 flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            Все указанные модели и эндпоинты официально бесплатны
          </span>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-all"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>
  );
};
