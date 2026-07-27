import type { GameState, PendingAction, ActionOption } from './types.js';
import { ALL_PLAYERS } from './data/players.js';
import { BOARD_CELLS } from './data/board.js';

// Track bank operation count per player (reset when leaving bank)
const bankOpCounts = new Map<number, number>();

/**
 * Bot decides which action to take based on the current game state.
 * Returns the action string (e.g. "ROLL_DICE", "BUY_CLUB:5", "END_TURN").
 */
export function botDecide(state: GameState): string {
  const pa = state.pendingAction;
  if (!pa || pa.options.length === 0) return 'OK';

  const enabled = pa.options.filter(o => !o.disabled);
  let pick = enabled.length > 0 ? enabled : pa.options;

  // Determine which player the bot is
  const botId = getBotPlayerId(state);
  const p = botId !== undefined ? state.players[botId] : undefined;

  // Reset bank counter when not at bank
  if (pa.type !== 'loan') {
    if (botId !== undefined) bankOpCounts.set(botId, 0);
  }

  // Single option: just take it
  if (pa.options.length === 1 && pa.type === 'post_move') {
    return pa.options[0].action;
  }

  // ---- Smart decisions by action type ----
  if (p) {
    if (pa.type === 'loan') {
      // Bank: max 3 operations then leave
      const count = (bankOpCounts.get(botId!) || 0) + 1;
      bankOpCounts.set(botId!, count);
      const leave = pick.find(o => o.action === 'DECLINE_LOAN');
      if (count > 3) {
        if (leave) return leave.action;
      } else {
        if (p.cash > 10 || p.savings > 10) {
          const noLoan = pick.filter(o => !o.action.startsWith('TAKE_LOAN'));
          if (noLoan.length > 0) pick = noLoan;
        }
        const repayAll = pick.find(o => o.action.startsWith('REPAY_LOAN:') && o.action.includes('全部'));
        const repayBig = pick.find(o => o.action.startsWith('REPAY_LOAN:10') || o.action.startsWith('REPAY_LOAN:5'));
        const withdrawBig = pick.find(o => o.action.startsWith('WITHDRAW:10') || o.action.startsWith('WITHDRAW:5'));
        const withdrawAny = pick.find(o => o.action.startsWith('WITHDRAW:'));
        if (p.debt > 0 && p.cash >= 5 && repayBig) return repayBig.action;
        else if (p.debt > 0 && repayAll && p.cash >= p.debt) return repayAll.action;
        else if (p.debt > 0 && p.savings >= 5 && withdrawBig) return withdrawBig.action;
        else if (p.debt > 0 && p.savings > 0 && withdrawAny) return withdrawAny.action;
        else if (p.debt > 0) { if (leave) return leave.action; }
        else if (p.cash < 5 && p.savings > 5 && withdrawBig) return withdrawBig.action;
        else if (p.cash < 5) { if (leave) return leave.action; }
      }
    }

    if (pa.type === 'transfer_bid' && !pa.options.some(o => o.action === 'YOUTH_DRAW')) {
      const bidOpt = pick.find(o => o.action.startsWith('PLACE_BID') || o.action.startsWith('START_BID'));
      const leaveOpt = pick.find(o => o.action === 'SKIP_TRANSFER' || o.action === 'PASS_BID');
      if (bidOpt && !bidOpt.disabled) return bidOpt.action;
      if (leaveOpt) return leaveOpt.action;
    }

    if (pa.type === 'transfer_sell') {
      const sellOpt = pick.find(o => o.action.startsWith('SELL_PLAYER'));
      const leaveOpt = pick.find(o => o.action === 'SKIP_TRANSFER');
      if (p.debt >= 20 && sellOpt) return sellOpt.action;
      if (p.debt >= 10 && sellOpt && Math.random() < 0.5) return sellOpt.action;
      if (leaveOpt) return leaveOpt.action;
    }

    if (pa.type === 'upgrade') {
      const totalSlots = Object.entries(state.cellOwners)
        .filter(([, oid]) => oid === p.id)
        .reduce((sum, [cid]) => sum + (state.cellLevels[parseInt(cid)] || 1), 0);
      const totalPlayers = state.instances.filter(i => i.ownerId === p.id).length;
      if (totalSlots - totalPlayers <= 1) {
        const upOpt = pick.find(o => o.action.startsWith('UPGRADE'));
        if (upOpt && !upOpt.disabled) return upOpt.action;
      }
    }

    if (pa.type === 'buy_club' || pa.type === 'buy_sponsor') {
      const buyOpt = pick.find(o =>
        (o.action.startsWith('BUY_CLUB') || o.action.startsWith('BUY_SPONSOR')) && !o.disabled
      );
      if (buyOpt) {
        const myClubs = Object.entries(state.cellOwners).filter(([, oid]) => oid === p.id);
        if (myClubs.length === 0 || p.cash > 10) return buyOpt.action;
      }
    }

    // Youth academy: cash > 5kw → always buy
    if (pa.type === 'transfer_bid' && pa.options.some(o => o.action === 'YOUTH_DRAW')) {
      const youthOpt = pick.find(o => o.action === 'YOUTH_DRAW' && !o.disabled);
      if (youthOpt && p.cash > 5) return youthOpt.action;
    }

	    if (pa.type === 'visit_or_challenge') {
	      const challOpt = pick.find(o => o.action.startsWith('CHALLENGE') && !o.disabled);
	      if (challOpt) {
	        // 智能挑战：对比主队人数x和我方最强队人数y
	        const homeClubId = pa.cellId;
	        const x = state.instances.filter(i => i.clubId === homeClubId).length;
	        const myClubIds = Object.entries(state.cellOwners).filter(([, oid]) => oid === p.id).map(([cid]) => parseInt(cid));
	        let y = 0;
	        for (const cid of myClubIds) { const cnt = state.instances.filter(i => i.clubId === cid).length; if (cnt > y) y = cnt; }
	        if (x === 0) { return challOpt.action; }
	        else if (x > 2 * y) { /* 不挑战 */ }
	        else if (y > x) { if (Math.random() < 0.8) return challOpt.action; }
	        else if (y === x) { if (Math.random() < 0.6) return challOpt.action; }
	        else if (y > x / 2) { if (Math.random() < 0.3) return challOpt.action; }
	      }
	    }

    if (pa.type === 'match_setup') {
      if (state.peakDuel) {
        const peakOpts = pick.filter(o => !o.disabled);
        if (peakOpts.length > 0) return peakOpts[Math.floor(Math.random() * peakOpts.length)].action;
      } else {
        const matchOpts = pick.filter(o => o.action.startsWith('START_MATCH') && !o.disabled);
        if (matchOpts.length > 0) {
          let best = matchOpts[0], bestCount = 0, bestOvr = 0;
          for (const opt of matchOpts) {
            const parts = opt.action.split(':');
            const cid = parseInt(parts[2]);
            const count = state.instances.filter(i => i.clubId === cid).length;
            const avgOvr = count > 0
              ? state.instances.filter(i => i.clubId === cid).reduce((s, i) => {
                  const c = ALL_PLAYERS.find(x => x.id === i.cardId);
                  return s + (c?.ovr || 0);
                }, 0) / count
              : 0;
            if (count > bestCount || (count === bestCount && avgOvr > bestOvr)) {
              best = opt; bestCount = count; bestOvr = avgOvr;
            }
          }
          return best.action;
        }
      }
    }

    if (pa.type === 'street_food' || pa.type === 'street_animal') {
      const buy = pick.find(o => o.action.startsWith('BUY_STREET'));
      if (buy && !buy.disabled) return buy.action;
    }

    // Match income: prefer repay debt
    if (pa.type === 'visit_or_challenge' && pa.options.some(o => o.action.startsWith('MATCH_INCOME:repay'))) {
      const repay = pick.find(o => o.action.startsWith('MATCH_INCOME:repay'));
      if (repay && p.debt > 0) return repay.action;
      if (p.cash < 5) {
        const cash = pick.find(o => o.action.startsWith('MATCH_INCOME:cash'));
        if (cash) return cash.action;
      }
    }
  }

  // Fallback: pick a random enabled option, preferring safe ones
  const safe = pick.find(o =>
    o.action === 'SKIP_BUY' || o.action === 'SKIP_UPGRADE' ||
    o.action === 'SKIP_STREET' || o.action === 'SKIP_TRANSFER' ||
    o.action === 'OK' || o.action === 'DECLINE_LOAN' ||
    o.action === 'PASS_BID' || o.action === 'AIRPORT_SKIP'
  );
  return safe ? safe.action : pick[Math.floor(Math.random() * pick.length)].action;
}

/** Find which player is the current bot (current turn + isAI) */
export function getBotPlayerId(state: GameState): number | undefined {
  const cp = state.players[state.currentPlayerIndex];
  if (cp?.isAI) return cp.id;

  // Match picking: check if home/away is AI
  if (state.matchState?.phase === 'picking') {
    const homeP = state.players[state.matchState.homePlayerId];
    const awayP = state.players[state.matchState.awayPlayerId];
    if (homeP?.isAI && !state.matchState.homePick) return homeP.id;
    if (awayP?.isAI && !state.matchState.awayPick) return awayP.id;
  }

  // Transfer bidding
  if (state.transferBidState?.phase === 'bidding') {
    const bidderId = state.transferBidState.bidders[state.transferBidState.bidderIndex];
    if (state.players[bidderId]?.isAI) return bidderId;
  }

  // Pending action with specific playerId
  if (state.pendingAction?.playerId !== undefined) {
    if (state.players[state.pendingAction.playerId]?.isAI) return state.pendingAction.playerId;
  }

  return undefined;
}

/** Check if it's currently a bot's turn/action */
export function isBotTurn(state: GameState): boolean {
  return getBotPlayerId(state) !== undefined;
}

/** Bot picks a match player (for PICK_MATCH_PLAYER) */
export function botPickMatchPlayer(state: GameState): { side: 'home' | 'away'; instanceUid: string } | null {
  if (!state.matchState || state.matchState.phase !== 'picking') return null;

  const ms = state.matchState;
  const isHomeBot = state.players[ms.homePlayerId]?.isAI;
  const isAwayBot = state.players[ms.awayPlayerId]?.isAI;

  if (isHomeBot && !ms.homePick) {
    const avail = ms.homeSquad.filter(uid => !ms.homeUsed.includes(uid));
    if (avail.length > 0) return { side: 'home', instanceUid: avail[Math.floor(Math.random() * avail.length)] };
  }
  if (isAwayBot && !ms.awayPick) {
    const avail = ms.awaySquad.filter(uid => !ms.awayUsed.includes(uid));
    if (avail.length > 0) return { side: 'away', instanceUid: avail[Math.floor(Math.random() * avail.length)] };
  }
  return null;
}
