import React from 'react';
import { useGame } from '../../state/GameContext';
import { getCellPosition } from '../../data/board';
import Cell from '../Cell/Cell';
import PlayerToken from '../PlayerToken/PlayerToken';
import DiceAnimation from '../DiceAnimation/DiceAnimation';
import styles from './Board.module.css';

export default function Board() {
  const { gameState: state } = useGame();
  if (!state) return null;

  const { cells, players, instances, clubTrophies, cellOwners, cellLevels } = state;

  // Build 11x11 grid
  const grid: (number | null)[][] = Array.from({ length: 11 }, () =>
    Array(11).fill(null)
  );
  cells.forEach(cell => {
    const { row, col } = getCellPosition(cell.id);
    if (row < 11 && col < 11) grid[row][col] = cell.id;
  });

  // Group players by cell
  const playersByCell: Record<number, typeof players> = {};
  players.forEach(p => {
    if (p.isBankrupt) return;
    if (!playersByCell[p.position]) playersByCell[p.position] = [];
    playersByCell[p.position].push(p);
  });

  return (
    <div className={styles.container}>
      <div className={styles.titleBar}>
        <span className={styles.gameTitle}>⚽ 足球大富翁</span>
        <span className={styles.round}>第 {state.turn} 轮</span>
      </div>
      <div className={styles.grid}>
        {grid.map((row, ri) => (
          <div key={ri} className={styles.row}>
            {row.map((cellId, ci) => {
              if (cellId === null) {
                return <div key={`${ri}-${ci}`} className={styles.empty} />;
              }
              const cell = cells[cellId];
              if (!cell) return <div key={`${ri}-${ci}`} className={styles.empty} />;
              return (
                <div key={cellId} className={styles.cellWrapper}>
                  <Cell
                    cell={cell}
                    isOwned={cellOwners[cellId] !== undefined}
                    ownerColor={
                      cellOwners[cellId] !== undefined
                        ? players.find(p => p.id === cellOwners[cellId])?.color
                        : undefined
                    }
                    level={cellLevels[cellId]}
                    playerCount={instances.filter(i => i.clubId === cellId).length}
                    trophyCount={clubTrophies[cellId]?.total || 0}
                  />
                  {playersByCell[cellId] && (
                    <div className={styles.tokens}>
                      {playersByCell[cellId].map(p => (
                        <PlayerToken key={p.id} player={p} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
      <DiceAnimation />
    </div>
  );
}
