import React from 'react';
import { 
  ShieldCheck, 
  ExternalLink, 
  Key, 
  CheckCircle2, 
  AlertTriangle, 
  Zap, 
  Terminal, 
  Laptop, 
  Layers,
  Copy,
  Check,
  Bot,
  Sparkles,
  Code2
} from 'lucide-react';

export const FreeProvidersGuide: React.FC = () => {
  const [copiedCmd, setCopiedCmd] = React.useState<string | null>(null);

  const copyCommand = (cmd: string, id: string) => {
    navigator.clipboard.writeText(cmd);
    setCopiedCmd(id);
    setTimeout(() => setCopiedCmd(null), 2000);
  };

  const providers = [
    {
      name: 'OpenRouter Free Pool (:free)',
      url: 'https://openrouter.ai/keys',
      badge: 'Самый большой выбор',
      cost: '0$ (Карта не требуется)',
      limits: '20 запросов / мин на пользователя',
      features: [
        '50+ моделей с суффиксом :free (Qwen 2.5 Coder 32B, DeepSeek R1, Llama 3.3 70B)',
        'Баланс 0.00$ позволяет бесконечно вызывать все :free модели',
        'Единый OpenAI-совместимый API эндпоинт',
      ],
      steps: [
        'Перейдите на openrouter.ai/keys и авторизуйтесь через Google или GitHub',
        'Нажмите "Create Key", дайте название ключу (например, "VS Code Free")',
        'Скопируйте полученный ключ формата sk-or-v1-... в генератор конфига',
      ],
    },
    {
      name: 'Groq Cloud (LPU Inference)',
      url: 'https://console.groq.com/keys',
      badge: 'Самый быстрый (450+ tok/s)',
      cost: '0$ (Карта не требуется)',
      limits: '30 RPM / 14,400 запросов в день!',
      features: [
        'Безумная скорость генерации кода (300-500 токенов в секунду)',
        'Модели: qwen-2.5-coder-32b, llama-3.3-70b-versatile, deepseek-r1-distill',
        'Идеально подходит для мгновенного автодополнения строк в реальном времени (Tab Autocomplete)',
      ],
      steps: [
        'Откройте console.groq.com/keys и войдите с GitHub/Google',
        'Нажмите "Create API Key" и сохраните gsk_...',
        'Вставьте в Continue.dev в секцию tabAutocompleteModel',
      ],
    },
    {
      name: 'Google AI Studio (Gemini Free Tier)',
      url: 'https://aistudio.google.com/apikey',
      badge: 'Рекордный контекст: 1,000,000 токенов',
      cost: '0$ (Официальный Free Tier)',
      limits: '15 RPM / 1,500 запросов в день',
      features: [
        'Контекст 1 миллион токенов — можно загрузить весь репозиторий целиком',
        'Совместимость со спецификацией OpenAI API',
        'Флагманская скорость и анализ больших логов сборки',
      ],
      steps: [
        'Перейдите на aistudio.google.com/apikey',
        'Нажмите "Create API key" -> выберите проект',
        'Ключ готов к использованию без привязки банковской карты',
      ],
    },
    {
      name: 'GitHub Models & Azure AI Foundry',
      url: 'https://github.com/marketplace/models',
      badge: 'Прямо в вашем GitHub',
      cost: '0$ (Для всех аккаунтов GitHub)',
      limits: '15 RPM / 150 RPD на модель',
      features: [
        'Доступны Llama 3.3 70B, DeepSeek R1, GPT-4o mini, Phi-4',
        'Авторизация через стандартный GitHub Personal Access Token (PAT)',
        'Бесплатный хостинг на мощностях Microsoft Azure',
      ],
      steps: [
        'Перейдите на github.com/marketplace/models',
        'Сгенерируйте Personal Access Token в GitHub Settings -> Developer settings',
        'Используйте эндпоинт https://models.inference.ai.azure.com',
      ],
    },
  ];

  return (
    <div className="space-y-6">
      {/* Intro Header */}
      <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-300 text-xs font-medium border border-emerald-500/20 mb-2">
          <ShieldCheck className="w-3.5 h-3.5" />
          100% Легальные официальные бесплатные ключи без привязки карт
        </div>
        <h2 className="text-xl font-bold text-white tracking-tight">
          Как получить ключи ко всем бесплатным ИИ провайдерам за 2 минуты
        </h2>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">
          Все описанные сервисы предлагают щедрые официальные бесплатные лимиты для разработчиков. 
          Объединив их в один каскад, вы получаете свыше <strong>20,000+ бесплатных генераций кода в сутки</strong>!
        </p>
      </div>

      {/* Cloud Free Providers Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {providers.map((p, idx) => (
          <div key={idx} className="bg-slate-900/70 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between gap-2 mb-2">
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
                  {p.badge}
                </span>
                <span className="text-xs font-medium text-slate-400">{p.cost}</span>
              </div>

              <h3 className="text-base font-bold text-white mb-1">{p.name}</h3>

              <div className="p-2 rounded-lg bg-slate-950/80 border border-slate-800 text-xs text-amber-400 font-mono mb-3">
                Лимит: {p.limits}
              </div>

              <div className="space-y-1.5 mb-4">
                <span className="text-xs font-semibold text-slate-300">Возможности:</span>
                <ul className="space-y-1 text-xs text-slate-400">
                  {p.features.map((f, fIdx) => (
                    <li key={fIdx} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="space-y-1.5 pt-3 border-t border-slate-800/80">
                <span className="text-xs font-semibold text-slate-300">Пошаговая инструкция:</span>
                <ol className="space-y-1 text-xs text-slate-400 list-decimal list-inside">
                  {p.steps.map((s, sIdx) => (
                    <li key={sIdx} className="leading-relaxed">
                      {s}
                    </li>
                  ))}
                </ol>
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-800">
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                className="w-full py-2 px-4 rounded-xl bg-slate-800 hover:bg-emerald-600 hover:text-white text-slate-200 text-xs font-semibold flex items-center justify-center gap-2 transition-all"
              >
                <span>Перейти и получить ключ</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            </div>
          </div>
        ))}
      </div>

      {/* OpenCode AI Coding Agent Guide */}
      <div className="bg-slate-900/80 border border-emerald-500/30 rounded-2xl p-6 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                OpenCode: Автономный терминальный агент для кодинга (CLI & TUI)
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-medium">
                  100% Open Source
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Запускайте автономного ИИ-агента в терминале прямо в этом проекте через OpenRouter Free или Groq
              </p>
            </div>
          </div>

          <a
            href="https://opencode.ai"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0"
          >
            <span>opencode.ai</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5" />
              Поддержка 75+ провайдеров
            </div>
            <p className="text-slate-400">
              Работает с бесплатными ключами OpenRouter, Groq, Google Gemini и локальным Ollama.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <Code2 className="w-3.5 h-3.5" />
              Автономное выполнение
            </div>
            <p className="text-slate-400">
              Агент читает файлы в репозитории, планирует шаги, применяет diff-патчи и запускает линтер.
            </p>
          </div>
          <div className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 text-xs text-slate-300 space-y-1">
            <div className="font-semibold text-emerald-400 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" />
              TUI & Скрипты
            </div>
            <p className="text-slate-400">
              Интерактивный полноэкранный интерфейс в терминале либо разовый запуск через <code>opencode run</code>.
            </p>
          </div>
        </div>

        <div className="space-y-3 font-mono text-xs">
          <div>
            <span className="text-slate-400 block mb-1 text-[11px] font-sans">1. Установка OpenCode CLI:</span>
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-emerald-400">
              <code>npm i -g opencode-ai</code>
              <button
                onClick={() => copyCommand('npm i -g opencode-ai', 'opencode_install')}
                className="hover:text-white p-1 text-slate-400"
              >
                {copiedCmd === 'opencode_install' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <span className="text-slate-400 block mb-1 text-[11px] font-sans">2. Запуск в проекте (файл opencode.json уже готов в корне):</span>
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-emerald-400">
              <code>opencode</code>
              <button
                onClick={() => copyCommand('opencode', 'opencode_run')}
                className="hover:text-white p-1 text-slate-400"
              >
                {copiedCmd === 'opencode_run' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <span className="text-slate-400 block mb-1 text-[11px] font-sans">3. Разовая задача в CLI (например, аудит кода):</span>
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-emerald-400">
              <code>opencode run "Проверь проект на потенциальные баги и оптимизируй запросы"</code>
              <button
                onClick={() => copyCommand('opencode run "Проверь проект на потенциальные баги и оптимизируй запросы"', 'opencode_cmd')}
                className="hover:text-white p-1 text-slate-400"
              >
                {copiedCmd === 'opencode_cmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* VLESS Reality & Built-in VPN Anti-Censorship Section */}
      <div className="bg-slate-900/80 border border-emerald-500/40 rounded-2xl p-6 relative overflow-hidden shadow-xl shadow-emerald-950/20">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Обход гео-блокировок ИИ через встроенный VPN (VLESS Reality)
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-mono font-medium">
                  Решено без общего VPN
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Прямой доступ к OpenRouter, Groq, Google AI Studio и Claude без необходимости включать глобальный VPN на компьютере
              </p>
            </div>
          </div>

          <div className="px-3.5 py-1.5 rounded-xl bg-slate-800 text-emerald-400 text-xs font-semibold flex items-center gap-1.5 border border-slate-700 shrink-0">
            <span>URL подписки задаётся в конфиге</span>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3.5 mb-5 text-xs">
          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="font-bold text-emerald-300 flex items-center gap-1.5">
              <Zap className="w-3.5 h-3.5" /> 1. Встроенный переключатель
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              В правом верхнем углу шапки нажмите <strong>VPN: ВКЛ</strong>. Запросы в интерактивной песочнице будут автоматически ретранслироваться через зарубежный узел без ошибок 403 Forbidden.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-cyan-500/30 space-y-1">
            <span className="font-bold text-cyan-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-3.5 h-3.5 text-cyan-400" /> 2. Часовой парсер подписки
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Бэкенд в фоновом режиме каждый час (3600 сек) перечитывает подписку по настроенному URL, парсит свежие VLESS Reality конфигурации и отсекает устаревшие ноды.
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-amber-500/30 space-y-1">
            <span className="font-bold text-amber-300 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" /> 3. Режим Auto-Best
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Система непрерывно измеряет задержку серверов и автоматически перенаправляет запросы на узел с минимальным пингом (Франкфурт, Амстердам и др.).
            </p>
          </div>

          <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-1">
            <span className="font-bold text-teal-300 flex items-center gap-1.5">
              <Terminal className="w-3.5 h-3.5" /> 4. Локальный порт 10808
            </span>
            <p className="text-slate-400 text-[11px] leading-relaxed">
              Клиенты вроде <strong>Sing-box</strong> или <strong>Hiddify</strong> слушают локальный порт 10808 для связки с OpenCode CLI, Continue и VS Code.
            </p>
          </div>
        </div>

        <div className="space-y-3 font-mono text-xs">
          <div>
            <span className="text-slate-400 block mb-1 text-[11px] font-sans">
              Команда запуска OpenCode через локальный прокси:
            </span>
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-emerald-400">
              <code>ALL_PROXY=socks5://127.0.0.1:10808 opencode</code>
              <button
                onClick={() => copyCommand('ALL_PROXY=socks5://127.0.0.1:10808 opencode', 'cmd_vpn_opencode')}
                className="hover:text-white p-1 text-slate-400"
              >
                {copiedCmd === 'cmd_vpn_opencode' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-slate-900/80 border border-purple-500/30 rounded-2xl p-6 relative overflow-hidden">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-500/20 text-purple-300 border border-purple-500/30">
              <Laptop className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Ollama: Локальный автономный кодинг без лимитов и интернета
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/40 font-mono font-medium">
                  100% Offline
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                Если пропал интернет или облачные квоты исчерпаны, локальная модель работает вечно и абсолютно бесплатно
              </p>
            </div>
          </div>

          <a
            href="https://ollama.com"
            target="_blank"
            rel="noreferrer"
            className="px-3.5 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0"
          >
            <span>Скачать с ollama.com</span>
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>

        <div className="space-y-3 font-mono text-xs">
          <div>
            <span className="text-slate-400 block mb-1 text-[11px]">1. Запуск лучшей компактной модели для кодинга (Qwen 2.5 Coder 7B):</span>
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-emerald-400">
              <code>ollama run qwen2.5-coder:7b</code>
              <button
                onClick={() => copyCommand('ollama run qwen2.5-coder:7b', 'cmd1')}
                className="hover:text-white p-1 text-slate-400"
              >
                {copiedCmd === 'cmd1' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>

          <div>
            <span className="text-slate-400 block mb-1 text-[11px]">2. Запуск модели с цепочкой рассуждений (DeepSeek R1 8B):</span>
            <div className="flex items-center justify-between bg-slate-950 p-2.5 rounded-xl border border-slate-800 text-emerald-400">
              <code>ollama run deepseek-r1:8b</code>
              <button
                onClick={() => copyCommand('ollama run deepseek-r1:8b', 'cmd2')}
                className="hover:text-white p-1 text-slate-400"
              >
                {copiedCmd === 'cmd2' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
