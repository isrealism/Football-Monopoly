import React from 'react';
import styles from './PlayerToken.module.css';

interface Props {
  player: {
    id: number;
    color: string;
  };
}

export default function PlayerToken({ player }: Props) {
  return (
    <div className={styles.token} style={{ backgroundColor: player.color }}>
      <span className={styles.num}>{player.id + 1}</span>
    </div>
  );
}
