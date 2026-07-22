import React, { useState } from 'react';
import { useGame } from '../../state/GameContext';
import styles from './RoomLobby.module.css';

export default function RoomLobby() {
  const { room, playerId, roomCode, addBot, removeBot, startGame, leaveRoom, send } = useGame();
  const [copied, setCopied] = useState(false);

  if (!room) return null;

  const isHost = playerId === room.hostId;
  const canStart = room.players.length >= 2;

  const copyRoomCode = () => {
    if (!roomCode) return;
    navigator.clipboard?.writeText(roomCode).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const canAddBot = room.players.length < 4;

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <h2 className={styles.title}>等待玩家加入</h2>

        {/* Room code display */}
        <div className={styles.roomCodeSection}>
          <span className={styles.codeLabel}>房间码</span>
          <button className={styles.codeBox} onClick={copyRoomCode}>
            <span className={styles.codeText}>{roomCode}</span>
            <span className={styles.copyHint}>{copied ? '✓ 已复制' : '点击复制'}</span>
          </button>
        </div>

        {/* Player list */}
        <div className={styles.playerSection}>
          <h3 className={styles.sectionTitle}>
            玩家 ({room.players.length}/4)
          </h3>
          <div className={styles.playerList}>
            {room.players.map(p => (
              <div key={p.id} className={styles.playerRow}>
                <span className={styles.dot} style={{ backgroundColor: p.color }} />
                <span className={styles.playerName}>
                  {p.name}
                  {p.isAI && ' 🤖'}
                  {p.id === room.hostId && ' 👑'}
                  {p.id === playerId && ' (你)'}
                </span>
                {isHost && p.id !== playerId && (
                  <button
                    className={styles.removeBtn}
                    onClick={() => p.isAI ? removeBot(p.id) : send({ type: 'LOBBY_REMOVE', targetId: p.id })}
                  >
                    移除
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Bot controls (host only) */}
        {isHost && (
          <div className={styles.botSection}>
            <button
              className={styles.botBtn}
              onClick={addBot}
              disabled={!canAddBot}
            >
              🤖 添加机器人
            </button>
            <span className={styles.botHint}>
              {canAddBot ? `还能加 ${4 - room.players.length} 个` : '已满员'}
            </span>
          </div>
        )}

        {/* Start button (host only) */}
        {isHost ? (
          <button
            className={styles.startBtn}
            onClick={startGame}
            disabled={!canStart}
          >
            {canStart ? '开始游戏 🎮' : `至少需要2人（当前${room.players.length}人）`}
          </button>
        ) : (
          <p className={styles.waiting}>等待房主开始游戏...</p>
        )}

        {/* Leave room */}
        <button className={styles.leaveBtn} onClick={leaveRoom}>
          退出房间
        </button>
      </div>
    </div>
  );
}
