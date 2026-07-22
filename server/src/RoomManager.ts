import type { GameState } from './types.js';
import { gameReducer, PLAYER_COLORS, createEmptyState, resetIdCounter } from './gameEngine.js';
import { ALL_PLAYERS } from './data/players.js';

// Random bot names from player database
const USED_BOT_NAMES = new Set<string>();
function randomBotName(): string {
  const available = ALL_PLAYERS.filter(p => !USED_BOT_NAMES.has(p.name));
  if (available.length === 0) { USED_BOT_NAMES.clear(); return ALL_PLAYERS[Math.floor(Math.random() * ALL_PLAYERS.length)].name; }
  const pick = available[Math.floor(Math.random() * available.length)];
  USED_BOT_NAMES.add(pick.name);
  return pick.name;
}

export interface RoomPlayer {
  id: number;
  name: string;
  color: string;
  isConnected: boolean;
  isAI: boolean;
}

export interface Room {
  code: string;
  hostId: number;
  players: RoomPlayer[];
  gameState: GameState | null;
  phase: 'lobby' | 'playing' | 'finished';
  createdAt: number;
  turnStartTime: number;
}

const rooms = new Map<string, Room>();
const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // No I,O to avoid confusion

function genRoomCode(): string {
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += ROOM_CODE_CHARS[Math.floor(Math.random() * ROOM_CODE_CHARS.length)];
    }
    if (!rooms.has(code)) return code;
  }
  throw new Error('Unable to generate unique room code');
}

function ensureUniqueColor(color: string, usedColors: Set<string>): string {
  if (!usedColors.has(color)) return color;
  const available = PLAYER_COLORS.find(c => !usedColors.has(c));
  return available || PLAYER_COLORS[usedColors.size % PLAYER_COLORS.length];
}

export function createRoom(playerName: string, playerColor: string): { room: Room; playerId: number } {
  const code = genRoomCode();
  const playerId = 0;
  const room: Room = {
    code,
    hostId: 0,
    players: [{ id: 0, name: playerName, color: ensureUniqueColor(playerColor, new Set()), isConnected: true, isAI: false }],
    gameState: null,
    phase: 'lobby',
    createdAt: Date.now(),
    turnStartTime: 0,
  };
  rooms.set(code, room);
  return { room, playerId };
}

export function joinRoom(code: string, playerName: string, playerColor: string): { room: Room; playerId: number } | null {
  const room = rooms.get(code.toUpperCase());
  if (!room || room.phase !== 'lobby') return null;
  if (room.players.length >= 4) return null;

  const usedColors = new Set(room.players.map(p => p.color));
  const playerId = room.players.length;
  room.players.push({ id: playerId, name: playerName, color: ensureUniqueColor(playerColor, usedColors), isConnected: true, isAI: false });
  return { room, playerId };
}

export function addBot(roomCode: string): Room | null {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'lobby') return null;
  if (room.players.length >= 4) return null;

  const botId = room.players.length;
  const usedColors = new Set(room.players.map(p => p.color));
  room.players.push({
    id: botId,
    name: randomBotName(),
    color: ensureUniqueColor(PLAYER_COLORS[botId % PLAYER_COLORS.length], usedColors),
    isConnected: true,
    isAI: true,
  });
  return room;
}

export function removeBot(roomCode: string, botId: number): Room | null {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'lobby') return null;
  const idx = room.players.findIndex(p => p.id === botId && p.isAI);
  if (idx < 0) return null;
  room.players.splice(idx, 1);
  return room;
}

export function removePlayer(roomCode: string, playerId: number): Room | null {
  const room = rooms.get(roomCode);
  if (!room) return null;
  const idx = room.players.findIndex(p => p.id === playerId);
  if (idx < 0) return null;
  const wasHost = room.players[idx].id === room.hostId;
  room.players.splice(idx, 1);
  if (room.players.length === 0) {
    rooms.delete(roomCode);
    return null;
  }
  // Reassign host if the host left
  if (wasHost) room.hostId = room.players[0].id;
  return room;
}

export function startGame(roomCode: string, hostId: number): GameState | null {
  const room = rooms.get(roomCode);
  if (!room || room.hostId !== hostId || room.phase !== 'lobby') return null;
  if (room.players.length < 2) return null;

  const players = room.players.map(p => ({
    name: p.name,
    color: p.color,
    isAI: p.isAI,
  }));
  room.phase = 'playing';
  resetIdCounter(0);
  room.gameState = gameReducer(createEmptyState(), { type: 'START_GAME', players });
  return room.gameState;
}

export function handleAction(roomCode: string, playerId: number, action: any): { state: GameState; error?: string } | null {
  const room = rooms.get(roomCode);
  if (!room || !room.gameState || room.phase !== 'playing') return null;

  const state = room.gameState;
  // Validate it's this player's turn (or match participant, etc.)
  const cp = state.players[state.currentPlayerIndex];
  if (!cp) return null;

  // Check if this player is allowed to act
  const allowed = isPlayerAllowed(state, playerId);
  if (!allowed) {
    return { state, error: '现在不是你的操作回合' };
  }

  room.gameState = gameReducer(state, action);
  return { state: room.gameState };
}

export function getRoomState(roomCode: string): Room | null {
  return rooms.get(roomCode) || null;
}

export function getGameState(roomCode: string): GameState | null {
  return rooms.get(roomCode)?.gameState || null;
}

export function markTurnStart(roomCode: string) {
  const room = rooms.get(roomCode);
  if (room) room.turnStartTime = Date.now();
}

export function kickPlayer(roomCode: string, targetId: number, kickerId: number): { room: Room; error?: string } | null {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'playing' || !room.gameState) return null;

  const target = room.players.find(p => p.id === targetId);
  if (!target) return { room, error: '找不到该玩家' };
  const gs = room.gameState;
  const gsTarget = gs.players[targetId];
  if (gsTarget?.isBankrupt) return { room, error: '该玩家已破产，无需踢出' };

  // Only the current turn player can be kicked after timeout
  if (gs.currentPlayerIndex !== targetId) return { room, error: '只能踢出当前回合的玩家' };

  const elapsed = (Date.now() - room.turnStartTime) / 1000;
  if (elapsed < 60) return { room, error: `还需等待 ${Math.ceil(60 - elapsed)} 秒` };

  // Kick: use reducer to properly process bankruptcy
  const kickedState = gameReducer(gs, { type: 'EXECUTE_BANKRUPT_ID', playerId: targetId } as any);
  room.gameState = kickedState;

  // Transfer host if needed
  if (targetId === room.hostId) room.hostId = kickerId;

  return { room };
}

export function lobbyRemovePlayer(roomCode: string, hostId: number, targetId: number): Room | null {
  const room = rooms.get(roomCode);
  if (!room || room.phase !== 'lobby') return null;
  if (room.hostId !== hostId) return null; // only host can remove
  if (targetId === hostId) return null; // can't remove self
  const idx = room.players.findIndex(p => p.id === targetId);
  if (idx < 0) return null;
  room.players.splice(idx, 1);
  return room;
}

export function removeRoom(roomCode: string) {
  rooms.delete(roomCode);
}

/** Check if the given playerId is allowed to act on the current state */
function isPlayerAllowed(state: GameState, playerId: number): boolean {
  // During a match, both participants can always act (pick, confirm, continue, forfeit)
  if (state.matchState) {
    if (playerId === state.matchState.homePlayerId || playerId === state.matchState.awayPlayerId) {
      return true;
    }
  }
  // Transfer bidding: the current bidder
  if (state.transferBidState && state.transferBidState.phase === 'bidding') {
    const bidderId = state.transferBidState.bidders[state.transferBidState.bidderIndex];
    if (playerId === bidderId) return true;
  }
  // Assign player: the owner
  if (state.pendingAction?.type === 'assign_player' && state.pendingAction.instanceUid) {
    const inst = state.instances.find(i => i.uid === state.pendingAction!.instanceUid);
    if (inst && inst.ownerId === playerId) return true;
  }
  // Peak duel: check playerId in pendingAction
  if (state.pendingAction?.playerId !== undefined && state.pendingAction.playerId === playerId) {
    return true;
  }
  // Normal turn
  if (state.currentPlayerIndex === playerId) return true;
  return false;
}
