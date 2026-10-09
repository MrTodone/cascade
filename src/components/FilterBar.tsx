import React from 'react';
import { Search, SlidersHorizontal, ArrowUpDown, Filter, Sparkles, Zap, Brain, HardDrive, Terminal } from 'lucide-react';

interface FilterBarProps {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  selectedTag: string;
  setSelectedTag: (tag: string) => void;
  selectedProvider: string;
  setSelectedProvider: (provider: string) => void;
  minScore: number;
  setMinScore: (score: number) => void;
  sortBy: 'score' | 'context' | 'speed' | 'name';
  setSortBy: (sort: 'score' | 'context' | 'speed' | 'name') => void;
  providersList: string[];
}

export const FilterBar: React.FC<FilterBarProps> = ({
  searchQuery,
  setSearchQuery,
  selectedTag,
  setSelectedTag,
  selectedProvider,
  setSelectedProvider,
  minScore,
  setMinScore,
  sortBy,
  setSortBy,
  providersList,
}) => {
  const tags = [
    { id: 'all', label: 'Все модели', icon: Sparkles },
    { id: 'top_coder', label: 'Топ Кодинг (≥95)', icon: Terminal },
    { id: 'reasoning', label: 'Reasoning (CoT/R1)', icon: Brain },
    { id: 'high_speed', label: 'Сверхбыстрые (>200 t/s)', icon: Zap },
    { id: 'huge_context', label: 'Контекст (≥64k)', icon: HardDrive },
  ];

  return (
    <div className="space-y-3.5 bg-slate-900/70 border border-slate-800 p-4 rounded-2xl">
      {/* Top row: Search input + Provider dropdown + Sort selector */}
      <div className="flex flex-col md:flex-row items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            id="search-models-input"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Поиск по названию (qwen, deepseek, llama), архитектуре, языкам..."
            className="w-full pl-10 pr-4 py-2 rounded-xl bg-slate-950 border border-slate-800 text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30 transition-all font-sans"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-white"
            >
              Очистить
            </button>
          )}
        </div>

        {/* Provider Filter */}
        <div className="flex items-center gap-2 w-full md:w-auto">
          <div className="relative flex-1 md:flex-initial">
            <select
              id="provider-select"
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="w-full md:w-48 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/60 transition-all cursor-pointer font-medium"
            >
              <option value="all">Все провайдеры</option>
              {providersList.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By */}
          <div className="relative flex-1 md:flex-initial">
            <select
              id="sort-by-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="w-full md:w-52 px-3 py-2 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 focus:outline-none focus:border-emerald-500/60 transition-all cursor-pointer font-medium"
            >
              <option value="score">Сортировка: Топ Кодинг</option>
              <option value="context">Сортировка: Контекст (макс)</option>
              <option value="speed">Сортировка: Скорость (ток/с)</option>
              <option value="name">Сортировка: По названию</option>
            </select>
          </div>
        </div>
      </div>

      {/* Quick Tag Pills */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-800/60">
        <span className="text-xs text-slate-400 mr-1 flex items-center gap-1 font-medium">
          <Filter className="w-3 h-3 text-emerald-400" />
          Фильтры:
        </span>
        {tags.map((tag) => {
          const Icon = tag.icon;
          const isActive = selectedTag === tag.id;
          return (
            <button
              key={tag.id}
              onClick={() => setSelectedTag(tag.id)}
              className={`px-3 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                isActive
                  ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                  : 'bg-slate-950/60 hover:bg-slate-800 border border-slate-800/80 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3 h-3" />
              {tag.label}
            </button>
          );
        })}

        {/* Min score quick slider indicator */}
        <div className="ml-auto hidden lg:flex items-center gap-2 text-xs text-slate-400">
          <span>Мин. балл:</span>
          <input
            type="range"
            min="30"
            max="98"
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="w-20 accent-emerald-500 cursor-pointer"
          />
          <span className="font-mono text-emerald-400 font-bold">{minScore}+</span>
        </div>
      </div>
    </div>
  );
};
