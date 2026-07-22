import React, { createContext, useContext } from 'react';
import type { GameState } from '../types';
import type { RoomInfo, WsState } from '../ws';
import { useWebSocket } from '../ws';

interface GameContextType {
  status: WsState['status'];
  roomCode: string | null;
  room: RoomInfo | null;
  playerId: number | null;
  error: string | null;
  gameState: GameState | null;
  botHighlight: { action: string; color: string } | null;
  createRoom: (name: string, color: string) => void;
  joinRoom: (code: string, name: string, color: string) => void;
  addBot: () => void;
  removeBot: (botId: number) => void;
  startGame: () => void;
  sendAction: (action: any) => void;
  send: (data: any) => void;
  leaveRoom: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const ws = useWebSocket();

  const ctx: GameContextType = {
    status: ws.status,
    roomCode: ws.roomCode,
    room: ws.room,
    playerId: ws.playerId,
    error: ws.error,
    gameState: ws.gameState,
    botHighlight: ws.botHighlight,
    createRoom: (name, color) => ws.send({ type: 'CREATE_ROOM', playerName: name, playerColor: color }),
    joinRoom: (code, name, color) => ws.send({ type: 'JOIN_ROOM', roomCode: code, playerName: name, playerColor: color }),
    addBot: () => ws.send({ type: 'ADD_BOT' }),
    removeBot: (botId) => ws.send({ type: 'REMOVE_BOT', botId }),
    startGame: () => ws.send({ type: 'START_GAME' }),
    sendAction: ws.sendAction,
    send: ws.send,
    leaveRoom: ws.leaveRoom,
  };

  return <GameContext.Provider value={ctx}>{children}</GameContext.Provider>;
}

export function useGame(): GameContextType {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
