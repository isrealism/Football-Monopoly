import React, { useState } from 'react';
import { useGame } from '../../state/GameContext';
import RulesScreen from '../RulesScreen/RulesScreen';
import styles from './SetupScreen.module.css';

const COLORS = ['#ff69b4', '#f5f5f5', '#fff176', '#a0522d', '#c4a4e0', '#81c784', '#ff5f1f'];
const COLOR_NAMES = ['粉', '白', '浅黄', '棕', '浅紫', '浅绿', '荧光橙'];

export default function SetupScreen() {
  const { createRoom, joinRoom, error, send, roomCode } = useGame();
  const [tab, setTab] = useState<'create' | 'join'>('create');
  const [name, setName] = useState('');
  const [colorIdx, setColorIdx] = useState(0);
  const [inputCode, setInputCode] = useState('');
  const [showRules, setShowRules] = useState(false);

  const handleCreate = () => {
    const n = name.trim() || '玩家';
    createRoom(n, COLORS[colorIdx]);
  };

  const handleJoin = () => {
    if (!inputCode.trim()) return;
    const n = name.trim() || '玩家';
    joinRoom(inputCode.trim().toUpperCase(), n, COLORS[colorIdx]);
  };

  const handleLoad = (slot: 1 | 2) => {
    const n = name.trim() || '玩家';
    createRoom(n, COLORS[colorIdx]);
    // After room created, load save — handled by ws.ts state change
    pendingLoadRef.current = slot;
  };
  const pendingLoadRef = React.useRef<number | null>(null);

  // When room is created, fire the load
  React.useEffect(() => {
    if (pendingLoadRef.current !== null && roomCode != null) {
      send({ type: 'LOAD_GAME', slot: pendingLoadRef.current! });
      pendingLoadRef.current = null;
    }
  }, [roomCode]);

  return (
    <div className={styles.overlay}>
      <div className={styles.card}>
        <h1 className={styles.title}>⚽ 足球大富翁</h1>
        <p className={styles.subtitle}>多人联机版</p>

        {/* Tabs */}
        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${tab === 'create' ? styles.tabOn : ''}`}
            onClick={() => setTab('create')}
          >
            创建房间
          </button>
          <button
            className={`${styles.tab} ${tab === 'join' ? styles.tabOn : ''}`}
            onClick={() => setTab('join')}
          >
            加入房间
          </button>
        </div>

        {/* Name input */}
        <div className={styles.field}>
          <label className={styles.label}>你的名字</label>
          <input
            className={styles.input}
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="输入名字"
            maxLength={10}
          />
        </div>

        {/* Color picker */}
        <div className={styles.field}>
          <label className={styles.label}>选择颜色</label>
          <div className={styles.colorRow}>
            {COLORS.map((c, i) => (
              <button
                key={i}
                className={`${styles.colorBtn} ${colorIdx === i ? styles.selected : ''}`}
                style={{ backgroundColor: c }}
                onClick={() => setColorIdx(i)}
                title={COLOR_NAMES[i]}
              />
            ))}
          </div>
        </div>

        {/* Room code (join tab) */}
        {tab === 'join' && (
          <div className={styles.field}>
            <label className={styles.label}>房间码</label>
            <input
              className={`${styles.input} ${styles.codeInput}`}
              value={inputCode}
              onChange={e => setInputCode(e.target.value.toUpperCase())}
              placeholder="输入4位房间码"
              maxLength={4}
            />
          </div>
        )}

        {/* Error */}
        {error && <p className={styles.error}>{error}</p>}

        {/* Action button */}
        {tab === 'create' ? (
          <button className={styles.startBtn} onClick={handleCreate}>
            创建房间 🏠
          </button>
        ) : (
          <button
            className={styles.startBtn}
            onClick={handleJoin}
            disabled={!inputCode.trim()}
          >
            加入房间 🚪
          </button>
        )}

        {/* Load game & Rules */}
        <div className={styles.bottomRow}>
          <button className={styles.subBtn} onClick={() => handleLoad(1)}>📂 读档1</button>
          <button className={styles.subBtn} onClick={() => handleLoad(2)}>📂 读档2</button>
          <button className={styles.subBtn} onClick={() => setShowRules(true)}>📖 规则</button>
        </div>
      </div>
      {showRules && <RulesScreen onClose={() => setShowRules(false)} />}
    </div>
  );
}
