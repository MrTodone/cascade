import React, { useState } from 'react';
import { AIModel, CodingTaskType, VpnStatus } from '../types';
import { 
  Play, 
  Copy, 
  Check, 
  Terminal, 
  Cpu, 
  Gauge, 
  Clock, 
  Code2, 
  Sparkles, 
  AlertCircle,
  Bug,
  RefreshCw,
  Wand2,
  Zap,
  Bot,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal
} from 'lucide-react';

interface CodePlaygroundProps {
  models: AIModel[];
  selectedModel: AIModel | null;
  onSelectModel: (model: AIModel) => void;
  vpnStatus?: VpnStatus;
  onToggleVpn?: () => void;
  onOpenVpnModal?: () => void;
}

const PRESET_TASKS = [
  {
    title: 'LRU Cache с TTL (TypeScript)',
    language: 'typescript',
    taskType: 'generate' as CodingTaskType,
    prompt: 'Напиши высокопроизводительный LRU Cache с поддержкой Time-To-Live (TTL) для каждого ключа, автоматической очисткой устаревших элементов и O(1) операциями get/set.',
  },
  {
    title: 'Worker Pool с Concurrency Limit (Python)',
    language: 'python',
    taskType: 'generate' as CodingTaskType,
    prompt: 'Реализуй асинхронный Worker Pool на asyncio с ограничением максимального количества параллельных задач (concurrency limit), очередью с приоритетом и graceful shutdown при сигнале SIGINT.',
  },
  {
    title: 'Поиск бага в Concurrency (Go)',
    language: 'go',
    taskType: 'debug' as CodingTaskType,
    prompt: `Найди скрытую гонку данных (data race) и deadlock в этом коде на Go и перепиши его безопасно:

package main
import ("sync"; "fmt")
func main() {
    var wg sync.WaitGroup
    m := make(map[string]int)
    for i := 0; i < 1000; i++ {
        wg.Add(1)
        go func(val int) {
            m["counter"] += val
            wg.Done()
        }(i)
    }
    wg.Wait()
    fmt.Println(m["counter"])
}`,
  },
  {
    title: 'Оптимизация SQL и индексы',
    language: 'sql',
    taskType: 'refactor' as CodingTaskType,
    prompt: 'Оптимизируй медленный запрос для таблицы заказов (orders) с миллионами строк. Предложи необходимые составные индексы (composite indexes) и explain plan анализ для поиска заказов пользователя за последние 30 дней со статусом completed.',
  },
  {
    title: 'Безопасный парсер JSON на Rust',
    language: 'rust',
    taskType: 'generate' as CodingTaskType,
    prompt: 'Напиши zero-copy парсер потока JSON логов на Rust с обработкой ошибок через Result, валидацией схемы и бенчмарком производительности.',
  },
];

export const CodePlayground: React.FC<CodePlaygroundProps> = ({
  models,
  selectedModel,
  onSelectModel,
  vpnStatus,
  onToggleVpn,
  onOpenVpnModal,
}) => {
  const currentModel = selectedModel || models[0];
  const [language, setLanguage] = useState('typescript');
  const [taskType, setTaskType] = useState<CodingTaskType>('generate');
  const [prompt, setPrompt] = useState(PRESET_TASKS[0].prompt);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [opencodeCopied, setOpencodeCopied] = useState(false);

  const handleCopyOpenCodeCmd = () => {
    const rawModel = currentModel?.modelId || 'qwen/qwen-2.5-coder-32b-instruct:free';
    const modelArg = rawModel.includes('/') ? `openrouter/${rawModel}` : (rawModel.startsWith('openrouter/') ? rawModel : `openrouter/${rawModel}`);
    const singleLinePrompt = prompt.trim().replace(/\n/g, ' ').replace(/"/g, '\\"');
    const cmd = `opencode run --model ${modelArg} "${singleLinePrompt || 'Write clean typed code'}"`;
    navigator.clipboard.writeText(cmd);
    setOpencodeCopied(true);
    setTimeout(() => setOpencodeCopied(false), 2200);
  };

  const handleApplyPreset = (preset: typeof PRESET_TASKS[0]) => {
    setLanguage(preset.language);
    setTaskType(preset.taskType);
    setPrompt(preset.prompt);
  };

  const handleRunTest = async () => {
    if (!prompt.trim()) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    setStats(null);

    try {
      const res = await fetch('/api/test-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          language,
          taskType,
          customModelId: currentModel ? currentModel.modelId : 'default',
        }),
      });

      const data = await res.json();
      if (data.success) {
        setResult(data.output);
        setStats(data.stats);
      } else {
        setError(data.error || 'Ошибка генерации ответа');
      }
    } catch (err: any) {
      setError(err.message || 'Ошибка сети при обращении к серверу');
    } finally {
      setIsRunning(false);
    }
  };

  const handleCopyCode = () => {
    if (!result) return;
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-medium border border-emerald-500/20 mb-2">
            <Sparkles className="w-3.5 h-3.5" />
            Интерактивная песочница и бенчмарк кодинга
          </div>
          <h2 className="text-xl font-bold text-white tracking-tight">
            Тестирование генерации и решения задач
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Проверьте качество генерации кода, скорость в токенах/сек и глубину рефакторинга в реальном времени.
          </p>
        </div>

        {/* Model Selector in Playground */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <span className="text-xs text-slate-400 font-medium shrink-0">Модель:</span>
          <select
            value={currentModel?.id || ''}
            onChange={(e) => {
              const found = models.find((m) => m.id === e.target.value);
              if (found) onSelectModel(found);
            }}
            className="w-full md:w-72 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-emerald-300 font-medium focus:outline-none focus:border-emerald-500 cursor-pointer"
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.codingScore}/100)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Built-in VPN Anti-Censorship Status Banner */}
      {vpnStatus && (
        <div className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs transition-all ${
          vpnStatus.enabled 
            ? 'bg-gradient-to-r from-emerald-950/40 via-slate-900 to-teal-950/30 border-emerald-500/30 text-emerald-200' 
            : 'bg-slate-900/90 border-slate-800 text-slate-400'
        }`}>
          <div className="flex items-center gap-2.5">
            <div className={`p-1.5 rounded-lg border ${vpnStatus.enabled ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' : 'bg-slate-800 border-slate-700 text-slate-500'}`}>
              {vpnStatus.enabled ? <ShieldCheck className="w-4 h-4" /> : <ShieldAlert className="w-4 h-4" />}
            </div>
            <div>
              <div className="font-semibold text-white flex items-center gap-2 flex-wrap">
                <span>{vpnStatus.enabled ? 'Встроенный VPN обход активен' : 'Встроенный VPN выключен'}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded font-mono ${
                  vpnStatus.enabled ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                }`}>
                  {vpnStatus.enabled ? 'VLESS Reality' : 'Direct'}
                </span>
                {vpnStatus.enabled && vpnStatus.autoBestEnabled && (
                  <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold flex items-center gap-1">
                    ⚡ Auto-Best ({vpnStatus.activeNode?.pingMs || 32}ms)
                  </span>
                )}
                <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-950/60 text-cyan-300 border border-cyan-500/30 font-mono hidden md:inline">
                  Каждый час
                </span>
              </div>
              <p className="text-[11px] text-slate-300 mt-0.5">
                {vpnStatus.enabled ? (
                  <span>
                    Запросы к ИИ направляются через: <strong>{vpnStatus.activeNode?.flag} {vpnStatus.activeNode?.country}</strong> ({vpnStatus.activeNode?.host}) &bull; Задержка: <strong>{vpnStatus.activeNode?.pingMs || 32} ms</strong> &bull; Защита от блокировок
                  </span>
                ) : (
                  <span>Прямой вызов API без прокси (модели могут возвращать 403 Forbidden в заблокированных регионах)</span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            {onToggleVpn && (
              <button
                onClick={onToggleVpn}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  vpnStatus.enabled 
                    ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700' 
                    : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md shadow-emerald-950/40'
                }`}
              >
                {vpnStatus.enabled ? 'Выключить' : 'Включить VPN'}
              </button>
            )}
            {onOpenVpnModal && (
              <button
                onClick={onOpenVpnModal}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 flex items-center gap-1.5 transition-all"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-slate-400" />
                <span>Серверы ({vpnStatus.totalNodes})</span>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Preset Tasks Shortcuts */}
      <div>
        <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider block mb-2">
          Готовые тестовые кейсы (Presettings):
        </label>
        <div className="flex flex-wrap gap-2">
          {PRESET_TASKS.map((preset, idx) => (
            <button
              key={idx}
              onClick={() => handleApplyPreset(preset)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-emerald-500/30 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-all"
            >
              <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
              <span>{preset.title}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Main Grid: Prompt Controls & Code Output */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Input Prompt */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 space-y-4">
            {/* Language & Task Type row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Язык программирования:
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="typescript">TypeScript</option>
                  <option value="python">Python</option>
                  <option value="go">Go (Golang)</option>
                  <option value="rust">Rust</option>
                  <option value="c++">C++</option>
                  <option value="sql">SQL</option>
                  <option value="bash">Bash / Shell</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-slate-400 block mb-1">
                  Тип задачи:
                </label>
                <select
                  value={taskType}
                  onChange={(e) => setTaskType(e.target.value as CodingTaskType)}
                  className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 focus:outline-none focus:border-emerald-500"
                >
                  <option value="generate">Генерация кода (Generate)</option>
                  <option value="debug">Поиск багов (Debug / Fix)</option>
                  <option value="refactor">Рефакторинг (Refactor)</option>
                  <option value="explain">Анализ и объяснение</option>
                  <option value="test">Unit-тесты (Testing)</option>
                </select>
              </div>
            </div>

            {/* Prompt textarea */}
            <div>
              <label className="text-xs font-medium text-slate-400 block mb-1.5">
                Описание задачи или исходный код:
              </label>
              <textarea
                rows={9}
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Опишите функцию, вставьте проблемный код или сформулируйте ТЗ..."
                className="w-full p-3.5 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-200 font-mono placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-all resize-none"
              />
            </div>

            {/* Run button */}
            <button
              id="run-playground-test-btn"
              onClick={handleRunTest}
              disabled={isRunning || !prompt.trim()}
              className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-semibold text-xs shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition-all disabled:opacity-50 cursor-pointer"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Генерация решения моделью...</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current" />
                  <span>Запустить тест ({language})</span>
                </>
              )}
            </button>

            {/* Run in OpenCode CLI command copy */}
            <div className="pt-2 border-t border-slate-800/80">
              <button
                type="button"
                onClick={handleCopyOpenCodeCmd}
                className="w-full py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-900 border border-slate-800 hover:border-emerald-500/40 text-slate-300 hover:text-white text-xs font-mono flex items-center justify-between transition-all cursor-pointer"
                title="Скопировать команду для запуска этой задачи в OpenCode CLI"
              >
                <span className="flex items-center gap-1.5 font-sans text-[11px] text-slate-300">
                  <Bot className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Команда для OpenCode CLI:</span>
                </span>
                <span className="text-[11px] font-semibold text-emerald-400 flex items-center gap-1">
                  {opencodeCopied ? (
                    <>
                      <Check className="w-3 h-3 text-emerald-400" />
                      <span>Скопировано!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3 h-3" />
                      <span>opencode run</span>
                    </>
                  )}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Code Result & Live Stats */}
        <div className="lg:col-span-7">
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 flex flex-col h-full min-h-[460px]">
            {/* Result Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2">
                <Code2 className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-semibold text-white">
                  Результат генерации
                </span>
                {stats && (
                  <span className="text-[11px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md border border-emerald-500/20">
                    {stats.modelUsed}
                  </span>
                )}
              </div>

              {result && (
                <button
                  onClick={handleCopyCode}
                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium flex items-center gap-1.5 transition-all"
                >
                  {copied ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span className="text-emerald-400">Скопировано!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Копировать код</span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Performance Stats Bar */}
            {stats && (
              <div className="space-y-2 py-3 border-b border-slate-800/80">
                {stats.failoverNotice && (
                  <div className="px-2.5 py-1.5 rounded-lg bg-amber-500/10 border border-amber-500/25 text-amber-300 text-xs flex items-center gap-2 font-sans">
                    <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>{stats.failoverNotice}</span>
                  </div>
                )}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Время:</span>
                    <span className="text-slate-200 font-semibold">{stats.elapsedMs} ms</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Gauge className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Скорость:</span>
                    <span className="text-emerald-400 font-semibold">{stats.tokensPerSec} tok/s</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Cpu className="w-3.5 h-3.5 text-slate-500" />
                    <span>Токены:</span>
                    <span className="text-slate-200 font-semibold">~{stats.estimatedTokens}</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <ShieldCheck className={`w-3.5 h-3.5 ${stats.vpnRelayed ? 'text-emerald-400' : 'text-slate-500'}`} />
                    <span>VPN:</span>
                    <span className={`font-semibold truncate max-w-[110px] ${stats.vpnRelayed ? 'text-emerald-300' : 'text-slate-400'}`} title={stats.vpnNode || (stats.vpnRelayed ? 'VLESS Relay' : 'Выключен')}>
                      {stats.vpnRelayed ? (stats.vpnNode || 'Активен') : 'Прямой'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Code Body */}
            <div className="flex-1 mt-3 rounded-xl bg-slate-950 border border-slate-800 p-4 font-mono text-xs overflow-y-auto max-h-[500px]">
              {isRunning ? (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-400 gap-3">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-400" />
                  <p className="text-xs">Модель обрабатывает запрос и компилирует решение...</p>
                </div>
              ) : error ? (
                <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold">Ошибка: </span>
                    <span>{error}</span>
                  </div>
                </div>
              ) : result ? (
                <pre className="whitespace-pre-wrap text-slate-200 leading-relaxed">
                  {result}
                </pre>
              ) : (
                <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-slate-500 gap-2">
                  <Terminal className="w-8 h-8 opacity-40 text-emerald-500" />
                  <p className="text-xs text-center max-w-sm">
                    Выберите готовую задачу сверху или введите свой промпт, затем нажмите <strong>"Запустить тест"</strong>.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
