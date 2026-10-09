import React from 'react';
import { Zap, ShieldAlert, Cpu, ArrowRight, CheckCircle2, RotateCcw, Laptop, Terminal } from 'lucide-react';

interface StrategyBannerProps {
  onOpenConfig: () => void;
  onOpenPlayground: () => void;
}

export const StrategyBanner: React.FC<StrategyBannerProps> = ({ onOpenConfig, onOpenPlayground }) => {
  return (
    <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 relative overflow-hidden backdrop-blur-sm">
      <div className="absolute top-0 right-0 w-96 h-96 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20"></div>

      <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6 relative z-10">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-3">
            <Zap className="w-3.5 h-3.5" />
            Архитектура: Бесконечный Бесплатный Кодинг (Zero-Cost Dev Stack)
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
            Как программировать с ИИ абсолютно бесплатно и без лимитов?
          </h2>
          <p className="text-slate-400 text-sm mt-2 leading-relaxed">
            Большинство разработчиков платят $20–$100 в месяц за подписки Copilot или Cursor. 
            Секрет в том, что открытые флагманские модели (<strong>Qwen 2.5 Coder 32B</strong>, <strong>Llama 3.3 70B</strong>, <strong>DeepSeek R1</strong>) 
            предоставляются крупными провайдерами с официальными бесплатными квотами и без проблем подключаются в <strong>OpenCode</strong> (CLI & TUI агент), <strong>VS Code / Continue</strong>, <strong>Cursor</strong>, <strong>Cline</strong> и <strong>Aider</strong>.
          </p>
        </div>

        <div className="flex flex-wrap gap-3">
          <button
            onClick={onOpenConfig}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-950/40 transition-all flex items-center gap-2"
          >
            <Terminal className="w-4 h-4" />
            Собрать каскадный конфиг
          </button>
          <button
            onClick={onOpenPlayground}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-all flex items-center gap-2"
          >
            Тестировать вживую
          </button>
        </div>
      </div>

      {/* 5-Step Cascade Workflow */}
      <div className="mt-6 pt-6 border-t border-slate-800/80">
        <div className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4 flex items-center gap-2">
          <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
          5-уровневый каскад отказоустойчивости (Automatic Failover)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {/* Step 1 */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/40 transition-colors">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-emerald-400 font-semibold">УРОВЕНЬ 1</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/20 text-emerald-300 font-mono">450 tok/s</span>
            </div>
            <div className="font-semibold text-sm text-slate-200">Groq LPU (Qwen Coder)</div>
            <p className="text-xs text-slate-400 mt-1">
              Мгновенный автокомплит строк (Tab) без задержек. 14,400 бесплатных запросов в день.
            </p>
          </div>

          {/* Step 2 */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/40 transition-colors">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-teal-400 font-semibold">УРОВЕНЬ 2</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-teal-500/20 text-teal-300 font-mono">:free пул</span>
            </div>
            <div className="font-semibold text-sm text-slate-200">OpenRouter Free Tier</div>
            <p className="text-xs text-slate-400 mt-1">
              Qwen 2.5 Coder 32B и DeepSeek R1 для чата, рефакторинга и генерации функций.
            </p>
          </div>

          {/* Step 3 */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/40 transition-colors">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-sky-400 font-semibold">УРОВЕНЬ 3</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-sky-500/20 text-sky-300 font-mono">1M Context</span>
            </div>
            <div className="font-semibold text-sm text-slate-200">Google AI Studio Flash</div>
            <p className="text-xs text-slate-400 mt-1">
              Сканирование репозиториев целиком (1 миллион токенов контекста) 1500 запросов/день бесплатно.
            </p>
          </div>

          {/* Step 4 */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/40 transition-colors">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-amber-400 font-semibold">УРОВЕНЬ 4</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/20 text-amber-300 font-mono">Failover</span>
            </div>
            <div className="font-semibold text-sm text-slate-200">Cascade Proxy Rotator</div>
            <p className="text-xs text-slate-400 mt-1">
              При 429 коде ошибки локальный прокси мгновенно переключает IDE на следующую free модель.
            </p>
          </div>

          {/* Step 5 */}
          <div className="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-emerald-500/40 transition-colors">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="font-mono text-purple-400 font-semibold">УРОВЕНЬ 5</span>
              <span className="px-1.5 py-0.5 rounded text-[10px] bg-purple-500/20 text-purple-300 font-mono">Offline</span>
            </div>
            <div className="font-semibold text-sm text-slate-200">Ollama Local (7B/14B)</div>
            <p className="text-xs text-slate-400 mt-1">
              Абсолютный тыл: 0$ навсегда, без интернета, без лимитов на вашем процессоре/видеокарте.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
