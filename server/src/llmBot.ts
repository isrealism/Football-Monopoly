import type { ActionOption, GameState, PlayerInstance } from './types.js';
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { BOARD_CELLS } from './data/board.js';
import { ALL_PLAYERS, ATTR_NAMES, getPlayerCard } from './data/players.js';
import { calcCapital } from './utils/gameLogic.js';
import { botDecide, getBotPlayerId } from './botLogic.js';

interface LlmDecision {
  action: string;
  reason?: string;
}

interface MatchPickDecision {
  instanceUid: string;
  reason?: string;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';
let envLoaded = false;
let startupLogged = false;
let loadedEnvFiles: string[] = [];
const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getConfig() {
  loadLocalEnv();
  const provider = (process.env.LLM_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'openai')).toLowerCase();
  const isGemini = provider === 'gemini';
  const apiKey = isGemini
    ? process.env.GEMINI_API_KEY || process.env.LLM_API_KEY
    : process.env.LLM_API_KEY || process.env.OPENAI_API_KEY;
  const explicitlyDisabled = process.env.LLM_BOT_ENABLED === '0';
  return {
    provider,
    enabled: !explicitlyDisabled && !!apiKey,
    apiKey,
    baseUrl: (isGemini
      ? getGeminiBaseUrl()
      : process.env.LLM_BASE_URL || process.env.OPENAI_BASE_URL || DEFAULT_BASE_URL
    ).replace(/\/$/, ''),
    model: isGemini
      ? process.env.GEMINI_MODEL || process.env.LLM_MODEL || DEFAULT_GEMINI_MODEL
      : process.env.LLM_MODEL || process.env.OPENAI_MODEL || DEFAULT_MODEL,
    timeoutMs: Math.max(500, parseInt(process.env.LLM_BOT_TIMEOUT_MS || '2500', 10)),
  };
}

function getGeminiBaseUrl(): string {
  const configured = process.env.GEMINI_BASE_URL;
  if (!configured) return DEFAULT_GEMINI_BASE_URL;
  if (configured.includes('generativelanguage.googleapis.com')) return configured;
  if (process.env.GEMINI_ALLOW_CUSTOM_BASE_URL === '1') return configured;

  console.warn(`[llm-bot] ignoring non-Google GEMINI_BASE_URL=${configured}. Use GEMINI_ALLOW_CUSTOM_BASE_URL=1 to override.`);
  return DEFAULT_GEMINI_BASE_URL;
}

function loadLocalEnv() {
  if (envLoaded) return;
  envLoaded = true;

  for (const envPath of getEnvPaths()) {
    if (!existsSync(envPath)) continue;
    loadEnvFile(envPath);
  }
}

function getEnvPaths() {
  return [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'server/.env'),
    path.resolve(__dirname, '../.env'),
    path.resolve(__dirname, '../../server/.env'),
  ].filter((p, idx, all) => all.indexOf(p) === idx);
}

function loadEnvFile(envPath: string) {
  const lines = readFileSync(envPath, 'utf-8').split(/\r?\n/);
  loadedEnvFiles.push(envPath);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const rawValue = trimmed.slice(eq + 1).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.replace(/^["']|["']$/g, '');
  }
}

export function isLlmBotEnabled(): boolean {
  return getConfig().enabled;
}

export function logLlmBotStatus() {
  const config = getConfig();
  startupLogged = true;
  if (!config.enabled) {
    console.log(`[llm-bot] disabled. provider=${config.provider}, apiKey=${config.apiKey ? 'set' : 'missing'}, envFiles=${loadedEnvFiles.length ? loadedEnvFiles.join(',') : 'none'}`);
    return;
  }
  console.log(`[llm-bot] enabled. provider=${config.provider}, model=${config.model}, baseUrl=${config.baseUrl}, timeoutMs=${config.timeoutMs}, envFiles=${loadedEnvFiles.length ? loadedEnvFiles.join(',') : 'none'}`);
}

export async function llmDecideAction(state: GameState): Promise<string> {
  const fallback = botDecide(state);
  try {
    const pa = state.pendingAction;
    if (!pa) return fallback;

    const enabled = getEnabledOptions(pa.options);
    if (enabled.length === 0) return fallback;

    const botId = getBotPlayerId(state);
    if (botId === undefined) return fallback;

    const decision = await callLlm<LlmDecision>('action', {
      instruction: '选择一个当前最有利的动作。只能返回 options 里某个 action 的原文。',
      game: buildGameSummary(state, botId),
      pendingAction: {
        type: pa.type,
        message: pa.message,
        cell: pa.cellId !== undefined ? summarizeCell(state, pa.cellId) : null,
        options: enabled.map(o => ({ label: o.label, action: o.action, cost: o.cost ?? null })),
      },
    });

    const action = decision?.action;
    if (action && enabled.some(o => o.action === action)) {
      logDecision(state, botId, action, decision.reason);
      return action;
    }
  } catch (err) {
    logFallback('action', err);
  }
  return fallback;
}

export async function llmPickMatchPlayer(
  state: GameState,
  side: 'home' | 'away',
): Promise<{ instanceUid: string; reason?: string } | null> {
  try {
    const ms = state.matchState;
    if (!ms || ms.phase !== 'picking') return null;

    const availableUids = side === 'home'
      ? ms.homeSquad.filter(uid => !ms.homeUsed.includes(uid))
      : ms.awaySquad.filter(uid => !ms.awayUsed.includes(uid));
    if (availableUids.length === 0) return null;

    const playerId = side === 'home' ? ms.homePlayerId : ms.awayPlayerId;
    if (!state.players[playerId]?.isAI) return null;

    const opponentPickUid = side === 'home' ? ms.awayPick : ms.homePick;
    const decision = await callLlm<MatchPickDecision>('match_pick', {
      instruction: '选择本轮出场球员。骰子会在双方选人后随机决定比较属性，目标是最大化本轮和整场胜率。',
      rules: [
        '普通球员比较骰子对应六维属性：速度、射门、传球、盘带、防守、身体。',
        '门将使用 OVR；主队普通球员有 +1 主场加成。',
        '同一名球员整场只能使用一次；高等级比赛需要保留后续轮次战力。',
      ],
      game: buildGameSummary(state, playerId),
      match: {
        side,
        level: ms.level,
        round: ms.round,
        maxRounds: ms.maxRounds,
        score: { home: ms.homeScore, away: ms.awayScore },
        homeClub: summarizeCell(state, ms.homeClubId),
        awayClub: summarizeCell(state, ms.awayClubId),
        opponentAlreadyPicked: opponentPickUid ? summarizeInstance(state, opponentPickUid) : null,
        availablePlayers: availableUids.map(uid => summarizeInstance(state, uid)).filter(Boolean),
      },
    });

    const instanceUid = decision?.instanceUid;
    if (instanceUid && availableUids.includes(instanceUid)) {
      logDecision(state, playerId, `PICK:${instanceUid}`, decision.reason);
      return { instanceUid, reason: decision.reason };
    }
  } catch (err) {
    logFallback(`match_pick:${side}`, err);
  }
  return null;
}

async function callLlm<T>(task: string, payload: unknown): Promise<T | null> {
  const config = getConfig();
  if (!config.enabled || !config.apiKey) return null;
  if (!startupLogged && process.env.LLM_BOT_DEBUG === '1') logLlmBotStatus();

  const systemPrompt = [
    '你是足球大富翁的 AI 玩家。',
    '你要像认真想赢的人类玩家一样决策，但保持游戏有趣。',
    '只能输出一个 JSON 对象，不要 Markdown，不要解释。',
    '如果任务是 action，格式为 {"action":"...","reason":"..."}。',
    '如果任务是 match_pick，格式为 {"instanceUid":"...","reason":"..."}。',
  ].join('\n');
  const userPrompt = JSON.stringify({ task, payload });

  if (config.provider === 'gemini') {
    return callGemini<T>(config, systemPrompt, userPrompt);
  }

  return callOpenAiCompatible<T>(config, systemPrompt, userPrompt);
}

async function callOpenAiCompatible<T>(
  config: ReturnType<typeof getConfig>,
  systemPrompt: string,
  userPrompt: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        temperature: 0.35,
        max_tokens: 220,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[llm-bot] request failed: ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }

    const data = await res.json() as any;
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') return null;
    logRequestSuccess(config.provider, config.model, Date.now() - startedAt);
    return parseJsonObject<T>(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[llm-bot] ${msg}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGemini<T>(
  config: ReturnType<typeof getConfig>,
  systemPrompt: string,
  userPrompt: string,
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const model = config.model.startsWith('models/') ? config.model.slice('models/'.length) : config.model;
  const startedAt = Date.now();

  try {
    const res = await fetch(`${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': config.apiKey!,
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.35,
          maxOutputTokens: 220,
          responseMimeType: 'application/json',
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[llm-bot] gemini request failed: ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }

    const data = await res.json() as any;
    const content = data?.candidates?.[0]?.content?.parts
      ?.map((part: any) => typeof part?.text === 'string' ? part.text : '')
      .filter(Boolean)
      .join('\n');
    if (typeof content !== 'string' || !content.trim()) return null;
    logRequestSuccess(config.provider, config.model, Date.now() - startedAt);
    return parseJsonObject<T>(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[llm-bot] gemini ${msg}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function logRequestSuccess(provider: string, model: string, elapsedMs: number) {
  if (process.env.LLM_BOT_DEBUG !== '1') return;
  console.log(`[llm-bot] request ok. provider=${provider}, model=${model}, elapsedMs=${elapsedMs}`);
}

function logFallback(task: string, err: unknown) {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  console.warn(`[llm-bot] ${task} failed, using local bot fallback. ${msg}`);
}

function parseJsonObject<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]) as T;
    } catch {
      return null;
    }
  }
}

function getEnabledOptions(options: ActionOption[]) {
  const enabled = options.filter(o => !o.disabled);
  return enabled.length > 0 ? enabled : options;
}

function getPlayers(state: GameState) {
  return Array.isArray(state.players) ? state.players : [];
}

function getInstances(state: GameState) {
  return Array.isArray(state.instances) ? state.instances : [];
}

function getCellOwners(state: GameState) {
  return state.cellOwners && typeof state.cellOwners === 'object' ? state.cellOwners : {};
}

function buildGameSummary(state: GameState, botId: number) {
  const players = getPlayers(state);
  const bot = players[botId];
  return {
    turn: state.turn,
    bot: summarizePlayer(state, botId),
    currentPlayer: summarizePlayer(state, state.currentPlayerIndex),
    opponents: players.filter(p => p.id !== botId).map(p => summarizePlayer(state, p.id)),
    currentCell: bot ? summarizeCell(state, bot.position) : null,
    ownedClubs: summarizeOwnedClubs(state, botId),
    transferBid: state.transferBidState ? {
      card: summarizeCard(state.transferBidState.cardId),
      currentBid: state.transferBidState.currentBid,
      currentBidder: state.transferBidState.currentBidderId !== null
        ? players[state.transferBidState.currentBidderId]?.name
        : null,
      isSell: state.transferBidState.isSell,
    } : null,
    leagueTables: summarizeLeagueTables(state),
    recentLog: Array.isArray(state.log) ? state.log.slice(0, 6) : [],
  };
}

function summarizeLeagueTables(state: GameState) {
  const tables = Array.isArray(state.leagueTables) ? state.leagueTables : [];
  return tables.filter(Boolean).map(t => {
    const entries = Array.isArray(t.entries) ? t.entries : [];
    return {
      level: t.level,
      matchesPlayed: t.matchesPlayed,
      matchesNeeded: t.matchesNeeded,
      leaders: [...entries].sort((a, b) => b.points - a.points).slice(0, 4).map(e => ({
        club: BOARD_CELLS[e.clubId]?.name,
        owner: getPlayers(state)[e.ownerId]?.name,
        points: e.points,
      })),
    };
  });
}

function summarizePlayer(state: GameState, playerId: number) {
  const p = getPlayers(state)[playerId];
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    cash: p.cash,
    savings: p.savings,
    debt: p.debt,
    capital: calcCapital(p.cash, p.savings, p.debt),
    position: p.position,
    cell: BOARD_CELLS[p.position]?.name,
    isBankrupt: p.isBankrupt,
    clubCount: Object.values(getCellOwners(state)).filter(ownerId => ownerId === p.id).length,
    squadSize: getInstances(state).filter(i => i.ownerId === p.id).length,
    trainingPoints: state.trainingPoints[p.id] || 0,
    hasUCLTitle: !!state.hasUCLTitle[p.id],
  };
}

function summarizeOwnedClubs(state: GameState, playerId: number) {
  return Object.entries(getCellOwners(state))
    .filter(([, ownerId]) => ownerId === playerId)
    .map(([cid]) => {
      const id = parseInt(cid, 10);
      const squad = getInstances(state).filter(i => i.clubId === id);
      return {
        ...summarizeCell(state, id),
        squadSize: squad.length,
        squad: squad.map(i => summarizeInstance(state, i.uid)).filter(Boolean),
      };
    });
}

function summarizeCell(state: GameState, cellId: number) {
  const cell = BOARD_CELLS[cellId];
  if (!cell) return null;
  const ownerId = getCellOwners(state)[cellId];
  return {
    id: cell.id,
    name: cell.name,
    type: cell.type,
    league: cell.league ?? null,
    price: cell.price ?? null,
    level: state.cellLevels[cellId] || null,
    owner: ownerId !== undefined ? getPlayers(state)[ownerId]?.name : null,
  };
}

function summarizeInstance(state: GameState, uid: string) {
  const inst = getInstances(state).find(i => i.uid === uid);
  if (!inst) return null;
  const card = getPlayerCard(inst.cardId);
  if (!card) return null;
  return {
    uid: inst.uid,
    club: BOARD_CELLS[inst.clubId]?.name,
    card: summarizeCard(inst.cardId),
    effectiveOvr: getEffectiveOvr(inst),
    growth: inst.growth,
  };
}

function summarizeCard(cardId: string) {
  const card = getPlayerCard(cardId) || ALL_PLAYERS.find(p => p.id === cardId);
  if (!card) return null;
  return {
    id: card.id,
    name: card.name,
    marketValue: card.marketValue,
    ovr: card.ovr,
    attrs: card.isGK
      ? { OVR: card.ovr }
      : Object.fromEntries(ATTR_NAMES.map((name, idx) => [name, card.attrs[idx] ?? 0])),
    isGK: card.isGK,
  };
}

function getEffectiveOvr(inst: PlayerInstance): number {
  const card = getPlayerCard(inst.cardId);
  if (!card) return 0;
  if (card.isGK) return card.ovr + (inst.growth[0] || 0);
  const totalGrowth = inst.growth.reduce((sum, n) => sum + n, 0);
  return card.ovr + Math.floor(totalGrowth / 6);
}

function logDecision(state: GameState, botId: number, action: string, reason?: string) {
  if (process.env.LLM_BOT_DEBUG !== '1') return;
  const name = state.players[botId]?.name ?? botId;
  console.log(`[llm-bot] ${name} -> ${action}${reason ? ` (${reason})` : ''}`);
}
