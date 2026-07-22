import { useState, useRef, useCallback, useEffect } from 'react';
import type { GameState } from './types';

// Determine WebSocket URL based on environment
const WS_URL = (() => {
  if (typeof window === 'undefined') return '';
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  // In dev, Vite proxies /ws to server
  // In production, connect to same host on the WS port or same origin
  if (import.meta.env.DEV) {
    return `${proto}//${window.location.hostname}:3001`;
  }
  return `${proto}//${window.location.host}`;
})();

export interface RoomInfo {
  code: string;
  hostId: number;
  players: { id: number; name: string; color: string; isAI: boolean; isConnected: boolean }[];
  phase: 'lobby' | 'playing' | 'finished';
}

export interface WsState {
  status: 'disconnected' | 'connecting' | 'connected' | 'lobby' | 'playing' | 'finished';
  gameState: GameState | null;
  playerId: number | null;
  roomCode: string | null;
  room: RoomInfo | null;
  error: string | null;
  botHighlight: { action: string; color: string } | null;
}

export function useWebSocket() {
  const [state, setState] = useState<WsState>({
    status: 'disconnected',
    gameState: null,
    playerId: null,
    roomCode: null,
    room: null,
    error: null,
    botHighlight: null,
  });
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setState(s => ({ ...s, status: 'connecting', error: null }));

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setState(s => ({ ...s, status: 'connected' }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerMessage(msg);
      } catch { /* ignore parse errors */ }
    };

    ws.onclose = () => {
      setState(s => ({ ...s, status: 'disconnected' }));
      // Auto-reconnect after 3s
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      // ws.onclose will fire after this
    };
  }, []);

  const handleServerMessage = useCallback((msg: any) => {
    switch (msg.type) {
      case 'ROOM_CREATED':
        setState(s => ({
          ...s,
          status: 'lobby',
          roomCode: msg.roomCode,
          playerId: msg.playerId,
          room: msg.room,
        }));
        break;

      case 'ROOM_JOINED':
        setState(s => ({
          ...s,
          status: 'lobby',
          roomCode: msg.roomCode,
          playerId: msg.playerId,
          room: msg.room,
        }));
        break;

      case 'ROOM_STATE':
        setState(s => ({ ...s, room: msg.room }));
        break;

      case 'GAME_STARTED':
        setState(s => ({
          ...s,
          status: 'playing',
          gameState: msg.state,
          room: msg.room || s.room,
        }));
        break;

      case 'STATE_UPDATE':
        setState(s => ({
          ...s,
          gameState: msg.state,
          botHighlight: msg._botHighlight || null,
        }));
        break;

      case 'PLAYER_LEFT':
        if (msg.room) {
          setState(s => ({ ...s, room: msg.room }));
        }
        break;

      case 'KICKED':
        setState({
          status: 'connected',
          gameState: null,
          playerId: null,
          roomCode: null,
          room: null,
          error: '你被房主移出了房间',
          botHighlight: null,
        });
        break;

      case 'ERROR':
        setState(s => ({ ...s, error: msg.message }));
        // Clear error after 5s
        setTimeout(() => setState(s => ({ ...s, error: null })), 5000);
        break;
    }
  }, []);

  const send = useCallback((data: any) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(data));
    }
  }, []);

  const sendAction = useCallback((action: any) => {
    send({ type: 'ACTION', action });
  }, [send]);

  const leaveRoom = useCallback(() => {
    send({ type: 'LEAVE_ROOM' });
    setState({
      status: 'connected',
      gameState: null,
      playerId: null,
      roomCode: null,
      room: null,
      error: null,
      botHighlight: null,
    });
  }, [send]);

  // Connect on mount
  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return { ...state, send, sendAction, leaveRoom };
}
