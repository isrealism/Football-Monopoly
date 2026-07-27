import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { writeFile, readFile } from 'fs/promises';
import {
  createRoom, joinRoom, addBot, removeBot,
  suspendPlayer, hardRemovePlayer, resumePlayer,
  lobbyRemovePlayer, kickPlayer, markTurnStart,
  startGame, handleAction, getGameState, getRoomState
} from './RoomManager.js';
import { gameReducer, createEmptyState } from './gameEngine.js';
import { getBotPlayerId, isBotTurn } from './botLogic.js';
import { llmDecideAction, llmPickMatchPlayer, logLlmBotStatus } from './llmBot.js';
import path from 'path';
import { fileURLToPath } from 'url';

const PORT = parseInt(process.env.PORT || '3001');
const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, '../../client/dist');
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const connections = new Map<WebSocket, { roomCode: string; playerId: number }>();
const botTimers = new Map<string, ReturnType<typeof setTimeout>>(); // prevent duplicate bot steps
const botInFlight = new Set<string>();

app.use(express.static(CLIENT_DIST));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('*', (_req, res) => {
  res.sendFile(path.join(CLIENT_DIST, 'index.html'));
});

wss.on('connection', (ws) => {
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      handleMessage(ws, msg);
    } catch {
      send(ws, { type: 'ERROR', message: 'Invalid message format' });
    }
  });
  ws.on('close', () => {
    const conn = connections.get(ws);
    if (conn) {
      const room = suspendPlayer(conn.roomCode, conn.playerId);
      connections.delete(ws);
      if (room) broadcast(conn.roomCode, { type: 'ROOM_STATE', room: sanitizeRoom(room) });
    }
  });
});

function handleMessage(ws: WebSocket, msg: any) {
  switch (msg.type) {
    case 'CREATE_ROOM': {
      const { room, playerId, token } = createRoom(msg.playerName || '玩家', msg.playerColor || '#ff69b4');
      connections.set(ws, { roomCode: room.code, playerId });
      send(ws, { type: 'ROOM_CREATED', roomCode: room.code, playerId, token, room: sanitizeRoom(room) });
      break;
    }
    case 'JOIN_ROOM': {
      const result = joinRoom(msg.roomCode, msg.playerName || '玩家', msg.playerColor || '#f5f5f5');
      if (!result) { send(ws, { type: 'ERROR', message: '房间不存在或已满' }); return; }
      connections.set(ws, { roomCode: result.room.code, playerId: result.playerId });
      send(ws, { type: 'ROOM_JOINED', roomCode: result.room.code, playerId: result.playerId, token: result.token, room: sanitizeRoom(result.room) });
      broadcast(result.room.code, { type: 'ROOM_STATE', room: sanitizeRoom(result.room) }, ws);
      break;
    }
    case 'ADD_BOT': {
      const conn = connections.get(ws);
      if (conn) { const room = addBot(conn.roomCode); if (room) broadcast(conn.roomCode, { type: 'ROOM_STATE', room: sanitizeRoom(room) }); }
      break;
    }
    case 'REMOVE_BOT': {
      const conn = connections.get(ws);
      if (conn) { const room = removeBot(conn.roomCode, msg.botId); if (room) broadcast(conn.roomCode, { type: 'ROOM_STATE', room: sanitizeRoom(room) }); }
      break;
    }
    case 'START_GAME': {
      const conn = connections.get(ws);
      if (!conn) return;
      const state = startGame(conn.roomCode, conn.playerId);
      if (!state) { send(ws, { type: 'ERROR', message: '无法开始游戏' }); return; }
      broadcast(conn.roomCode, { type: 'GAME_STARTED', state: state, players: getRoomState(conn.roomCode)?.players || [] });
      markTurnStart(conn.roomCode);
      scheduleBotStep(conn.roomCode, 700);
      break;
    }
    case 'ACTION': {
      const conn = connections.get(ws);
      if (!conn) return;
      const result = handleAction(conn.roomCode, conn.playerId, msg.action);
      if (!result) { send(ws, { type: 'ERROR', message: '操作失败' }); return; }
      if (result.error) { send(ws, { type: 'ERROR', message: result.error }); return; }
      broadcastState(conn.roomCode);
      scheduleBotStep(conn.roomCode, 400);
      break;
    }
    case 'KICK_PLAYER': {
      const conn = connections.get(ws);
      if (!conn) return;
      const result = kickPlayer(conn.roomCode, msg.targetId, conn.playerId);
      if (!result) { send(ws, { type: 'ERROR', message: '踢人失败' }); return; }
      if (result.error) { send(ws, { type: 'ERROR', message: result.error }); return; }
      broadcastState(conn.roomCode);
      break;
    }

    case 'LOBBY_REMOVE': {
      const conn = connections.get(ws);
      if (!conn) return;
      const room = lobbyRemovePlayer(conn.roomCode, conn.playerId, msg.targetId);
      if (room) {
        broadcast(conn.roomCode, { type: 'ROOM_STATE', room: sanitizeRoom(room) });
        // Notify removed player
        for (const [w, c] of connections) {
          if (c.roomCode === conn.roomCode && c.playerId === msg.targetId) {
            send(w, { type: 'KICKED' });
            connections.delete(w);
            w.close();
          }
        }
      }
      break;
    }

    case 'SAVE_GAME': {
      const conn = connections.get(ws);
      if (!conn) return;
      const state = getGameState(conn.roomCode);
      if (!state || state.phase !== 'playing') { send(ws, { type: 'ERROR', message: '游戏未在进行中' }); return; }
      const path = `data/games/${conn.roomCode}_slot${msg.slot}.json`;
      writeFile(path, JSON.stringify(state)).then(() => {
        send(ws, { type: 'SAVED', slot: msg.slot });
      }).catch(() => {
        send(ws, { type: 'ERROR', message: '保存失败' });
      });
      break;
    }

    case 'LOAD_GAME': {
      const conn = connections.get(ws);
      if (!conn) return;
      const room = getRoomState(conn.roomCode);
      if (!room) return;
      if (room.hostId !== conn.playerId) { send(ws, { type: 'ERROR', message: '只有房主可以读档' }); return; }
      const path = `data/games/${conn.roomCode}_slot${msg.slot}.json`;
      readFile(path, 'utf-8').then(data => {
        const saved = JSON.parse(data);
        const state = gameReducer(createEmptyState(), { type: 'LOAD_GAME', state: saved } as any);
        // Update room
        const r = getRoomState(conn.roomCode);
        if (r) {
          r.gameState = state;
          r.phase = 'playing';
          broadcast(conn.roomCode, {
            type: 'GAME_STARTED',
            state,
            players: r.players,
          });
          markTurnStart(conn.roomCode);
          scheduleBotStep(conn.roomCode, 700);
        }
      }).catch(() => {
        send(ws, { type: 'ERROR', message: '存档不存在或已损坏' });
      });
      break;
    }

    case 'REJOIN': {
      const room = resumePlayer(msg.roomCode, msg.playerId, msg.token);
      if (!room) {
        send(ws, { type: 'REJOIN_FAILED' });
        return;
      }
      connections.set(ws, { roomCode: room.code, playerId: msg.playerId });
      send(ws, {
        type: 'REJOIN_OK',
        roomCode: room.code,
        playerId: msg.playerId,
        room: sanitizeRoom(room),
        state: room.gameState,
      });
      broadcast(room.code, { type: 'ROOM_STATE', room: sanitizeRoom(room) }, ws);
      break;
    }

    case 'LEAVE_ROOM': {
      const conn = connections.get(ws);
      if (conn) {
        const room = hardRemovePlayer(conn.roomCode, conn.playerId);
        connections.delete(ws);
        if (room) {
          broadcast(conn.roomCode, { type: 'ROOM_STATE', room: sanitizeRoom(room) });
        }
      }
      break;
    }
  }
}

// ========== Bot Step Chain ==========
// Single entry point for bot processing. Prevents duplicate calls.

function scheduleBotStep(roomCode: string, delayMs: number) {
  // Clear any pending bot step for this room
  const existing = botTimers.get(roomCode);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    botTimers.delete(roomCode);
    void botStep(roomCode);
  }, delayMs);
  botTimers.set(roomCode, timer);
}

async function botStep(roomCode: string) {
  if (botInFlight.has(roomCode)) return;
  botInFlight.add(roomCode);
  try {
  const state = getGameState(roomCode);
  if (!state || state.phase !== 'playing') return;
  
  // --- Match picking (bot side) — same as original: bots pick immediately, no delay ---
  if (state.matchState?.phase === 'picking') {
    const ms = state.matchState;
    const isHomeBot = state.players[ms.homePlayerId]?.isAI;
    const isAwayBot = state.players[ms.awayPlayerId]?.isAI;

    // Both bots, neither picked → let home pick first, then schedule away with updated state
    if (isHomeBot && isAwayBot && !ms.homePick && !ms.awayPick) {
      const homeAvail = ms.homeSquad.filter((uid: string) => !ms.homeUsed.includes(uid));
      if (homeAvail.length > 0) {
        const pick = await llmPickMatchPlayer(state, 'home');
        handleAction(roomCode, ms.homePlayerId, {
          type: 'PICK_MATCH_PLAYER',
          instanceUid: pick?.instanceUid || homeAvail[Math.floor(Math.random() * homeAvail.length)],
          side: 'home',
        });
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 300);
        return;
      }
    }

    // Home bot, not picked → pick immediately
    if (isHomeBot && !ms.homePick) {
      const avail = ms.homeSquad.filter((uid: string) => !ms.homeUsed.includes(uid));
      if (avail.length > 0) {
        const pick = await llmPickMatchPlayer(state, 'home');
        handleAction(roomCode, ms.homePlayerId, {
          type: 'PICK_MATCH_PLAYER',
          instanceUid: pick?.instanceUid || avail[Math.floor(Math.random() * avail.length)],
          side: 'home',
        });
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 300);
        return;
      }
    }

    // Away bot, home picked, away not → pick immediately
    if (isAwayBot && ms.homePick && !ms.awayPick) {
      const avail = ms.awaySquad.filter((uid: string) => !ms.awayUsed.includes(uid));
      if (avail.length > 0) {
        const pick = await llmPickMatchPlayer(state, 'away');
        handleAction(roomCode, ms.awayPlayerId, {
          type: 'PICK_MATCH_PLAYER',
          instanceUid: pick?.instanceUid || avail[Math.floor(Math.random() * avail.length)],
          side: 'away',
        });
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 300);
        return;
      }
    }

    return;
  }

  // --- Match auto-confirm (both bots) — same as original: 2s delay ---
  if (state.pendingAction?.type === 'match_pick' && state.matchState) {
    const ms = state.matchState;
    if (state.players[ms.homePlayerId]?.isAI && state.players[ms.awayPlayerId]?.isAI) {
      const timer = setTimeout(() => {
        handleAction(roomCode, ms.homePlayerId, { type: 'ROLL_MATCH_DICE' });
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 500);
      }, 2000);
      botTimers.set(roomCode, timer);
      return;
    }
    return;
  }

  // --- Match reveal auto-continue (both bots) — same as original: 1.5s delay ---
  if ((state.pendingAction?.type === 'match_reveal' ||
       (state.pendingAction?.type === 'post_move' && state.pendingAction.options[0]?.action === 'CONFIRM_MATCH_RESULT'))
      && state.matchState) {
    const ms = state.matchState;
    if (state.players[ms.homePlayerId]?.isAI && state.players[ms.awayPlayerId]?.isAI) {
      const timer = setTimeout(() => {
        handleAction(roomCode, ms.homePlayerId, { type: 'CONFIRM_MATCH_RESULT' });
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 500);
      }, 1500);
      botTimers.set(roomCode, timer);
      return;
    }
    return;
  }

  // Only process bot turns below here
  if (!isBotTurn(state)) return;

  // --- Dice animation: spinning → dispatch ROLL_DICE ---
  if (state.diceAnimating && state.diceValue === null) {
    const botColor = state.players[state.currentPlayerIndex]?.color || '#f0c060';
    // Show highlight for the upcoming roll
    broadcast(roomCode, { type: 'STATE_UPDATE', state, _botHighlight: { action: 'ROLL_DICE', color: botColor } });
    const timer = setTimeout(() => {
      handleAction(roomCode, state.players[state.currentPlayerIndex].id, { type: 'ROLL_DICE' });
      broadcastState(roomCode);
      scheduleBotStep(roomCode, 500);
    }, 600);
    botTimers.set(roomCode, timer);
    return;
  }

  // --- Dice animation: result shown → click MOVE ---
  if (state.diceAnimating && state.diceValue !== null) {
    const pa = state.pendingAction;
    if (pa && pa.options[0]?.action.startsWith('MOVE:')) {
      const steps = parseInt(pa.options[0].action.split(':')[1]);
      const botColor = state.players[state.currentPlayerIndex]?.color || '#f0c060';
      // Show highlight for the MOVE button
      broadcast(roomCode, { type: 'STATE_UPDATE', state, _botHighlight: { action: pa.options[0].action, color: botColor } });
      const timer = setTimeout(() => {
        handleAction(roomCode, state.players[state.currentPlayerIndex].id, { type: 'MOVE_PLAYER', steps });
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 500);
      }, 600);
      botTimers.set(roomCode, timer);
      return;
    }
    return;
  }

  // --- Pending action: bot needs to decide ---
  if (state.pendingAction) {
    const pa = state.pendingAction;

    // post_move with single option — highlight every action
    if (pa.type === 'post_move' && pa.options.length === 1) {
      const opt = pa.options[0];
      const botColor = state.players[state.currentPlayerIndex]?.color || '#f0c060';
      broadcast(roomCode, { type: 'STATE_UPDATE', state, _botHighlight: { action: opt.action, color: botColor } });
      const delay = opt.action === 'ROLL_DICE' ? 700 : 400;
      const realAction = opt.action === 'ROLL_DICE' ? 'ROLL_DICE' : opt.action === 'END_TURN' ? 'END_TURN' : opt.action;
      const timer = setTimeout(() => {
        stepBotAction(roomCode, realAction);
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 700);
      }, delay);
      // 5s safety timeout: force last/safe option
      const safetyTimer = setTimeout(() => {
        const st = getGameState(roomCode);
        if (st && st.pendingAction && isBotTurn(st)) {
          const safeOpt = st.pendingAction.options[st.pendingAction.options.length - 1];
          stepBotAction(roomCode, safeOpt.action);
          broadcastState(roomCode);
          scheduleBotStep(roomCode, 500);
        }
      }, 5000);
      botTimers.set(roomCode, timer);
      return;
    }

    // Multi-option: bot decides, highlight, then execute (5s safety timeout)
    const action = await llmDecideAction(state);
    const botId = getBotPlayerId(state) ?? state.currentPlayerIndex;
    const botPlayer = state.players[botId];
    const color = botPlayer?.color || '#f0c060';
    broadcast(roomCode, { type: 'STATE_UPDATE', state, _botHighlight: { action, color } });

    const timer = setTimeout(() => {
      stepBotAction(roomCode, action);
      broadcastState(roomCode);
      scheduleBotStep(roomCode, 500);
    }, 400);
    // 5s safety: force last option
    const safetyTimer = setTimeout(() => {
      const st = getGameState(roomCode);
      if (st && st.pendingAction && isBotTurn(st)) {
        const safeOpt = st.pendingAction.options[st.pendingAction.options.length - 1];
        stepBotAction(roomCode, safeOpt.action);
        broadcastState(roomCode);
        scheduleBotStep(roomCode, 500);
      }
    }, 5000);
    botTimers.set(roomCode, timer);
    return;
  }
  } finally {
    botInFlight.delete(roomCode);
  }
}

/** Execute a single bot action string */
function stepBotAction(roomCode: string, action: string) {
  const state = getGameState(roomCode);
  if (!state) return;
  const botId = getBotPlayerId(state) ?? state.players[state.currentPlayerIndex]?.id;
  if (botId === undefined) return;
  const pa = state.pendingAction;
  const cellId = pa?.cellId;

  if (action === 'END_TURN') {
    handleAction(roomCode, botId, { type: 'END_TURN' });
  } else if (action === 'ROLL_DICE') {
    handleAction(roomCode, botId, { type: 'START_DICE_ANIMATION' });
  } else if (action === 'OK') {
    handleAction(roomCode, botId, { type: 'CHOOSE_ACTION', action: 'OK' });
  } else {
    handleAction(roomCode, botId, { type: 'CHOOSE_ACTION', action, cellId });
  }
}

// ========== Helpers ==========
function broadcastState(roomCode: string) {
  const state = getGameState(roomCode);
  if (state) {
    broadcast(roomCode, { type: 'STATE_UPDATE', state });
    // Reset turn timer when a new player's turn starts
    if (state.phase === 'playing' && !state.matchState && !state.diceAnimating) {
      markTurnStart(roomCode);
    }
  }
}

function send(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function broadcast(roomCode: string, data: any, exclude?: WebSocket) {
  for (const [ws, conn] of connections) {
    if (conn.roomCode === roomCode && ws !== exclude && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }
}

function sanitizeRoom(room: any): any {
  return { code: room.code, hostId: room.hostId, players: room.players, phase: room.phase };
}

server.listen(PORT, () => {
  console.log(`⚽ Football Monopoly Server running on port ${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/health`);
  logLlmBotStatus();
});
