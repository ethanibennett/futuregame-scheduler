import { formatBuyin } from './utils.js';

export function detectMilestones(trackingData, newEntry) {
  const milestones = [];

  let totalBuyins = 0, totalCashes = 0, biggestCash = 0, biggestCashEvent = '';
  let previousPL = 0;
  const gameBests = {};

  for (const e of trackingData) {
    const cost = (e.buyin || 0) * (e.num_entries || 1);
    totalBuyins += cost;
    if (e.cashed) {
      totalCashes += e.cash_amount || 0;
      if ((e.cash_amount || 0) > biggestCash) {
        biggestCash = e.cash_amount;
        biggestCashEvent = e.event_name;
      }
    }
    const game = e.game_variant || 'Unknown';
    if (e.cashed && e.cash_amount) {
      if (!gameBests[game] || e.cash_amount > gameBests[game]) {
        gameBests[game] = e.cash_amount;
      }
    }
  }
  previousPL = totalCashes - totalBuyins;

  const newCost = (newEntry.buyin || 0) * (newEntry.numEntries || newEntry.num_entries || 1);
  totalBuyins += newCost;
  if (newEntry.cashed) {
    totalCashes += newEntry.cashAmount || newEntry.cash_amount || 0;
  }
  const newPL = totalCashes - totalBuyins;
  const newCashAmount = newEntry.cashAmount || newEntry.cash_amount || 0;

  if (previousPL < 0 && newPL >= 0) {
    milestones.push({
      type: 'break-even',
      title: 'BREAK EVEN!',
      description: 'Your series P&L just crossed into the green!',
      value: '+' + formatBuyin(newPL)
    });
  }

  if (previousPL <= 0 && newPL > 0 && trackingData.length > 0) {
    if (previousPL === 0 || !milestones.some(m => m.type === 'break-even')) {
      milestones.push({
        type: 'first-profit',
        title: 'IN THE GREEN!',
        description: 'First time with net positive results!',
        value: '+' + formatBuyin(newPL)
      });
    }
  }

  if (newEntry.cashed && newCashAmount > biggestCash && biggestCash > 0) {
    milestones.push({
      type: 'career-high',
      title: 'NEW PERSONAL BEST!',
      description: 'Biggest cash of the series! Previous: ' + formatBuyin(biggestCash),
      value: formatBuyin(newCashAmount)
    });
  }

  if (newEntry.cashed && newCashAmount > 0) {
    const game = newEntry.game_variant || 'Unknown';
    if (gameBests[game] && newCashAmount > gameBests[game]) {
      milestones.push({
        type: 'game-best',
        title: game.toUpperCase() + ' PB!',
        description: 'New personal best in ' + game + '! Previous: ' + formatBuyin(gameBests[game]),
        value: formatBuyin(newCashAmount)
      });
    }
  }

  return milestones;
}
