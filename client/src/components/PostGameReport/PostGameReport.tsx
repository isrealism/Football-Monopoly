import React from 'react';
import type { GameState } from '../../types';
import { calcCapital } from '../../utils/gameLogic';
import styles from './PostGameReport.module.css';

interface Props {
  state: GameState;
  playerId?: number;
  onClose?: () => void;
}

export default function PostGameReport({ state, playerId, onClose }: Props) {
  if (playerId !== undefined) {
    return <PlayerReport state={state} playerId={playerId} onClose={onClose} />;
  }

  // Show all players
  return (
    <div className={styles.overlay}>
      {onClose && <button className={styles.closeBtn} onClick={onClose}>✕</button>}
      <div className={styles.container}>
        <h2 className={styles.title}>赛后报告</h2>
        {state.players.map(p => {
          const stats = state.playerStats[p.id] || { totalIncome: 0, totalSpent: 0, jailCount: 0, matchesPlayed: 0, matchesWon: 0, championships: 0 };
          const capital = calcCapital(p.cash, p.savings, p.debt);
          return (
            <div key={p.id} className={styles.playerCard}>
              <div className={styles.pHeader}>
                <span className={styles.dot} style={{ backgroundColor: p.color }} />
                <span className={styles.pName}>{p.name}</span>
                {state.winner === p.id && <span className={styles.winBadge}>🏆 冠军</span>}
                {p.isBankrupt && <span className={styles.loseBadge}>💀 破产</span>}
              </div>
              <div className={styles.stats}>
                <span>资金: {capital.toFixed(1)}kw</span>
                <span>收入: {stats.totalIncome.toFixed(1)}kw</span>
                <span>支出: {stats.totalSpent.toFixed(1)}kw</span>
                <span>比赛: {stats.matchesWon}胜/{stats.matchesPlayed}场</span>
                <span>冠军: {stats.championships}次</span>
                <span>坐牢: {stats.jailCount}次</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PlayerReport({ state, playerId, onClose }: Props & { playerId: number }) {
  const p = state.players[playerId];
  if (!p) return null;
  const stats = state.playerStats[playerId] || { totalIncome: 0, totalSpent: 0, jailCount: 0, matchesPlayed: 0, matchesWon: 0, championships: 0 };
  const capital = calcCapital(p.cash, p.savings, p.debt);

  return (
    <div className={styles.overlay}>
      {onClose && <button className={styles.closeBtn} onClick={onClose}>✕</button>}
      <div className={styles.container}>
        <h2 className={styles.title} style={{ color: p.color }}>{p.name} 的赛后报告</h2>
        <div className={styles.bigCapital}>
          <span className={styles.capVal}>{capital.toFixed(1)}kw</span>
          <span className={styles.capLabel}>最终资金</span>
        </div>
        <div className={styles.stats}>
          <span>现金: {p.cash.toFixed(1)}kw</span>
          <span>存款: {p.savings.toFixed(1)}kw</span>
          <span>负债: {p.debt.toFixed(1)}kw</span>
          <span>总收入: {stats.totalIncome.toFixed(1)}kw</span>
          <span>总支出: {stats.totalSpent.toFixed(1)}kw</span>
          <span>比赛: {stats.matchesWon}胜/{stats.matchesPlayed}场</span>
          <span>冠军: {stats.championships}次</span>
          <span>坐牢: {stats.jailCount}次</span>
        </div>
      </div>
    </div>
  );
}
