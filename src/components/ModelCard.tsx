import React, { useState } from 'react';
import { AIModel } from '../types';
import { 
  Check, 
  Copy, 
  Code, 
  Sparkles, 
  Zap, 
  HardDrive, 
  Gauge, 
  Layers, 
  ExternalLink, 
  Plus, 
  ChevronDown, 
  ChevronUp, 
  Clock, 
  Terminal,
  ShieldCheck
} from 'lucide-react';

interface ModelCardProps {
  model: AIModel;
  isInCascade: boolean;
  onToggleCascade: (modelId: string) => void;
  onTestInPlayground: (model: AIModel) => void;
  providerHasKey?: boolean;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isInCascade,
  onToggleCascade,
  onTestInPlayground,
  providerHasKey = false,
}) => {
  const [copied, setCopied] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(model.modelId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Format context length
  const formatContext = (tokens: number) => {
    if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(0)}M токенов`;
    if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}k токенов`;
    return `${tokens} токенов`;
  };

  // Get score color
  const getScoreBadge = (score: number) => {
    if (score >= 95) {
      return {
        bg: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
        label: 'SOTA Coder',
      };
    }
    if (score >= 90) {
      return {
        bg: 'bg-teal-500/15 text-teal-300 border-teal-500/30',
        label: 'Advanced',
      };
    }
    return {
      bg: 'bg-slate-800 text-slate-300 border-slate-700',
      label: 'Standard',
    };
  };

  const scoreBadge = getScoreBadge(model.codingScore);

  return (
    <div
      className={`group relative rounded-2xl border transition-all duration-200 bg-slate-900/80 hover:bg-slate-900 ${
        isInCascade
          ? 'border-emerald-500/60 shadow-lg shadow-emerald-950/30 ring-1 ring-emerald-500/30'
          : 'border-slate-800 hover:border-slate-700'
      } p-5 flex flex-col justify-between`}
    >
      <div>
        {/* Top Badges */}
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Free Tag */}
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 font-mono">
              <ShieldCheck className="w-3 h-3" />
              100% Free / 0$
            </span>

            {/* Provider Pill */}
            <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-slate-800/80 text-slate-300 border border-slate-700/60">
              {model.provider}
            </span>

            {providerHasKey && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-sky-500/10 text-sky-300 border border-sky-500/30"
                title="Ключ подключён через Cascade"
              >
                <ShieldCheck className="w-3 h-3" />
                ключ подключён
              </span>
            )}
          </div>

          {/* Coding Benchmark Score */}
          <div className="flex items-center gap-1.5">
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-mono font-bold border ${scoreBadge.bg}`}
              title="Балл специализации в программировании (0-100)"
            >
              {model.codingScore} / 100
            </span>
          </div>
        </div>

        {/* Model Title */}
        <h3 className="text-base font-bold text-white group-hover:text-emerald-300 transition-colors leading-snug">
          {model.name}
        </h3>

        {/* Model ID Code Badge with Copy */}
        <div className="mt-2 flex items-center gap-2 bg-slate-950/80 rounded-lg p-1.5 border border-slate-800/90">
          <span className="text-[11px] font-mono text-emerald-400/90 truncate flex-1 pl-1">
            {model.modelId}
          </span>
          <button
            onClick={handleCopy}
            title="Скопировать ID модели для IDE"
            className="p-1 rounded-md hover:bg-slate-800 text-slate-400 hover:text-white transition-colors flex items-center gap-1 text-[10px] font-mono shrink-0"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3 text-emerald-400" />
                <span className="text-emerald-400">Скопировано!</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>ID</span>
              </>
            )}
          </button>
        </div>

        {/* Description */}
        <p className="text-xs text-slate-400 mt-2.5 line-clamp-2 leading-relaxed">
          {model.description}
        </p>

        {/* Specs Grid */}
        <div className="grid grid-cols-2 gap-2 mt-4 pt-3 border-t border-slate-800/60 text-xs">
          <div className="flex items-center gap-1.5 text-slate-400">
            <HardDrive className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[11px]">Контекст:</span>
            <span className="text-slate-200 font-mono font-medium ml-auto">
              {formatContext(model.contextLength)}
            </span>
          </div>

          <div className="flex items-center gap-1.5 text-slate-400">
            <Gauge className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span className="text-[11px]">Скорость:</span>
            <span className="text-emerald-400 font-mono font-medium ml-auto">
              ~{model.speedTokensSec} tok/s
            </span>
          </div>
        </div>

        {/* Free Quotas / Limits info */}
        <div className="mt-2.5 p-2 rounded-lg bg-slate-950/60 border border-slate-800/60 text-[11px] text-slate-300 flex items-start gap-1.5">
          <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-slate-300">Бесплатный лимит: </span>
            <span className="text-slate-400">{model.limits}</span>
          </div>
        </div>

        {/* Specialization Tags */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          {model.specializations.map((spec, idx) => (
            <span
              key={idx}
              className="text-[10px] px-2 py-0.5 rounded bg-slate-800/70 text-slate-300 border border-slate-700/50"
            >
              {spec}
            </span>
          ))}
        </div>
      </div>

      {/* Bottom Action Controls */}
      <div className="mt-5 pt-3 border-t border-slate-800 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {/* Add / Remove from IDE Cascade */}
          <button
            onClick={() => onToggleCascade(model.modelId)}
            className={`flex-1 py-1.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
              isInCascade
                ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-600/30'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700'
            }`}
          >
            {isInCascade ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span>В каскаде</span>
              </>
            ) : (
              <>
                <Plus className="w-3.5 h-3.5" />
                <span>Добавить в каскад</span>
              </>
            )}
          </button>

          {/* Test in Playground */}
          <button
            onClick={() => onTestInPlayground(model)}
            title="Запустить тест генерации кода с этой моделью"
            className="py-1.5 px-3 rounded-xl bg-slate-800/90 hover:bg-emerald-600/20 hover:text-emerald-300 border border-slate-700 text-slate-300 text-xs font-semibold flex items-center gap-1.5 transition-all shrink-0"
          >
            <Code className="w-3.5 h-3.5" />
            <span>Тест</span>
          </button>
        </div>

        {/* Collapsible Setup Guide Drawer */}
        <div className="mt-1">
          <button
            onClick={() => setShowDetails(!showDetails)}
            className="text-[11px] text-slate-400 hover:text-slate-200 flex items-center justify-between w-full py-1"
          >
            <span>Как подключить в IDE?</span>
            {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>

          {showDetails && (
            <div className="mt-2 p-3 rounded-xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-2">
              <p className="leading-relaxed text-[11px] text-slate-300">
                {model.setupGuide}
              </p>
              <div className="pt-1.5 border-t border-slate-800/80 flex items-center justify-between">
                <span className="text-[10px] text-slate-500 font-mono">API: {model.apiEndpoint}</span>
                {model.providerUrl && (
                  <a
                    href={model.providerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-[10px] text-emerald-400 hover:underline flex items-center gap-1 font-medium"
                  >
                    Сайт <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
