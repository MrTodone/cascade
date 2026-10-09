export interface AIModel {
  id: string;
  modelId: string;
  name: string;
  provider: string;
  providerUrl: string;
  apiEndpoint: string;
  contextLength: number;
  speedTokensSec: number;
  cost: string;
  limits: string;
  isFree: boolean;
  codingScore: number;
  architecture: string;
  description: string;
  specializations: string[];
  recommendedRoles: string[];
  setupGuide: string;
}

export type CodingTaskType = 'generate' | 'debug' | 'refactor' | 'explain' | 'test';

export interface BenchmarkResult {
  output: string;
  stats: {
    elapsedMs: number;
    estimatedTokens: number;
    tokensPerSec: number;
    modelUsed: string;
  };
}

export type ConfigTool = 'continue' | 'cline' | 'cursor' | 'aider' | 'opencode' | 'cascade_proxy';

export interface GeneratedConfig {
  tool: ConfigTool;
  fileName: string;
  configContent: string;
  instructions: string;
}

export interface VlessNode {
  id: string;
  name: string;
  country: string;
  flag: string;
  host: string;
  port: number | string;
  protocol: string;
  security: string;
  sni: string;
  pbk: string;
  sid?: string;
  flow?: string;
  fp?: string;
  rawUrl: string;
  pingMs?: number;
  isOnline?: boolean;
  isBest?: boolean;
  speedRating?: 'ultra' | 'fast' | 'medium' | 'slow' | 'offline';
  lastChecked?: string;
}

export interface RoutingModel {
  id: string;
  name: string;
  provider: string;
  providerKey: string;
  model: string;
  priority: number;
  context: number;
  hasApiKey: boolean;
  via: 'direct' | 'tunnel';
  health: 'ok' | 'broken' | 'degraded' | 'unknown';
  score: number;
}

export interface RoutingProvider {
  key: string;
  name: string;
  hasApiKey: boolean;
  via: 'direct' | 'tunnel';
}

export interface RoutingState {
  mode: 'auto' | 'manual';
  pinned: { id: string; name: string; provider: string; model: string } | null;
  stale: boolean;
  updatedAt: string;
  activeSet: { name: string; modelCount: number; autoHeal: boolean; lastResort: string };
  providers: RoutingProvider[];
  models: RoutingModel[];
}

export interface VpnStatus {
  enabled: boolean;
  activeNode: VlessNode | null;
  bestNode: VlessNode | null;
  totalNodes: number;
  lastSync: string;
  nextSync: string;
  subscriptionUrl: string;
  ipLocation?: string;
  relayMode: 'vless-reality' | 'direct';
  autoBestEnabled: boolean;
  autoSyncEnabled: boolean;
  lastSpeedTest?: string;
  nextSpeedTest?: string;
  isBenchmarking?: boolean;
  syncIntervalMinutes?: number;
  benchmarkIntervalMinutes?: number;
}
