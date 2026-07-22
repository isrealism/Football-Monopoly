import React from 'react';
import { useGame } from '../../state/GameContext';
import styles from './SavePanel.module.css';

export default function SavePanel() {
  const { send } = useGame();

  return (
    <span className={styles.inline}>
      <button className={styles.btn} onClick={() => send({ type: 'SAVE_GAME', slot: 1 })} title="存档1">💾1</button>
      <button className={styles.btn} onClick={() => send({ type: 'SAVE_GAME', slot: 2 })} title="存档2">💾2</button>
    </span>
  );
}
