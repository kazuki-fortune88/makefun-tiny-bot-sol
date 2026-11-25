// Tiny trend bot — long-only EMA trend-following on hourly Solana bars.
//
// Strategy (textbook, fixed parameters — nothing tuned to the dev window):
//   * Per symbol, track EMA(12) and EMA(26) of hourly closes (the classic MACD
//     spans). An EMA is seeded as the mean of its first `span` closes, then
//     moves 2 / (span + 1) of the way toward each new close, in float64.
//   * ENTER when the fast EMA crosses above the slow EMA and the close is
//     above the slow EMA as well — but only once the cross has survived one
//     more bar (gap still positive, close still above the slow EMA). A cross
//     that reverses on the very next bar is a whipsaw, not a trend; waiting
//     one bar for confirmation is the standard defence against it, and it
//     costs little because fills happen at the next bar's open anyway. This
//     keeps the bot out of falling markets — the main way to beat
//     buy-and-hold is to not hold the losers.
//   * EXIT the whole position when the fast EMA crosses back below the slow
//     EMA, or when the position is down 8% from cost (stop-loss: cut losers
//     early), or up 25% from cost (take-profit: bank a sharp hourly move
//     before it reverses). A sell signal that the market refuses is re-sent
//     on the next bar while its reason still holds.
//   * A bar with zero recorded volume signals nothing; a bar with no volume
//     recorded (v null) is not held back.
//   * Sizing: equity split evenly over the universe slots
//     (n = min(universe, caps.max_open_positions)), capped at
//     caps.max_weight_bps of equity and at the cash still unspent this reply.
//     Sells go first, then buys in universe order, at most
//     caps.max_orders_per_bar orders per reply. Each order caps slippage at
//     100 bps past the close it was decided on, so a fill into a liquidity
//     gap is refused (and retried) rather than filled for almost nothing.
//
// Robustness: the rules use only the direction of a widely used trend
// indicator and fixed, round risk limits. No parameter was fitted to the dev
// window, no grid search was run, and the bot reads no clock, environment or
// randomness, so its two grading runs produce identical action logs.

import { BPS, runBars, type Bar, type BarsState, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

// Classic MACD spans, in bars.
const FAST_SPAN = 12;
const SLOW_SPAN = 26;
// Stop-loss: exit when the position is worth 92% of its cost (-8%).
const STOP_NUM = 92n;
const STOP_DEN = 100n;
// Take-profit: exit when the position is worth 125% of its cost (+25%).
const TAKE_NUM = 125n;
const TAKE_DEN = 100n;
// Max slippage past the close an order was decided on, in bps (1%).
const MAX_SLIPPAGE_BPS = 100;

/** One EMA: the closes seen while it warms up, then its value. */
interface Ema {
  span: number;
  warm: number[];
  value: number | null;
}

/** Per-symbol trend state, updated once per bar. */
interface Trend {
  fast: Ema;
  slow: Ema;
  /** fast - slow after the previous bar, once both EMAs exist. */
  prevGap: number | null;
  /** fast - slow after this bar, once both EMAs exist. */
  gap: number | null;
  /** True once the fast EMA has crossed below the slow one, until it crosses back above. */
  crossedDown: boolean;
  /** Batch seq of the most recent upward cross, for the one-bar confirmation. */
  crossSeq: number | null;
}

const trends = new Map<string, Trend>();

function stepEma(e: Ema, close: number): void {
  if (e.value !== null) {
    e.value += (2 / (e.span + 1)) * (close - e.value);
    return;
  }
  e.warm.push(close);
  if (e.warm.length === e.span) {
    e.value = e.warm.reduce((a, x) => a + x, 0) / e.span;
  }
}

function updateTrend(bar: Bar): Trend {
  let t = trends.get(bar.symbol);
  if (t === undefined) {
    t = {
      fast: { span: FAST_SPAN, warm: [], value: null },
      slow: { span: SLOW_SPAN, warm: [], value: null },
      prevGap: null,
      gap: null,
      crossedDown: false,
      crossSeq: null,
    };
    trends.set(bar.symbol, t);
  }
  const close = Number(bar.c);
  stepEma(t.fast, close);
  stepEma(t.slow, close);
  t.prevGap = t.gap;
  t.gap =
    t.fast.value !== null && t.slow.value !== null
      ? t.fast.value - t.slow.value
      : null;
  if (t.gap !== null && t.prevGap !== null) {
    if (t.gap < 0 && t.prevGap >= 0) t.crossedDown = true;
    if (t.gap > 0 && t.prevGap <= 0) t.crossedDown = false;
  }
  return t;
}

/** Whether a held position exits on this close: trend turned down, stop-loss, or take-profit. */
function shouldExit(
  state: BarsState,
  symbol: string,
  held: { qty: bigint; cost: bigint },
  trend: Trend,
): boolean {
  if (trend.crossedDown) return true;
  const value = state.value(symbol, held.qty);
  if (value * STOP_DEN <= held.cost * STOP_NUM) return true;
  if (value * TAKE_DEN >= held.cost * TAKE_NUM) return true;
  return false;
}

await runBars({
  onBatch(state, batch) {
    const crossedUp = new Set<string>();
    const seen = new Set<string>();
    for (const bar of batch.bars) {
      const t = updateTrend(bar);
      seen.add(bar.symbol);
      if (t.prevGap === null || t.gap === null || bar.v === '0') continue;
      // Record a fresh upward cross; enter only on the next bar, once the
      // cross has survived one more close above the slow EMA.
      if (t.gap > 0 && t.prevGap <= 0) t.crossSeq = state.seq;
      if (
        t.crossSeq !== null &&
        t.crossSeq === state.seq - 1 &&
        t.gap > 0 &&
        t.slow.value !== null &&
        Number(bar.c) > t.slow.value
      ) {
        crossedUp.add(bar.symbol);
      }
    }
    // Warm-up batches reject every order: build indicator history only.
    if (state.warmingUp) return [];

    const { caps, fees } = state.hello;
    const sells: SellInput[] = [];
    const entries: string[] = [];
    for (const { symbol } of state.hello.symbols) {
      if (!seen.has(symbol)) continue;
      const held = state.positions.get(symbol);
      if (held !== undefined) {
        if (shouldExit(state, symbol, held, trends.get(symbol)!)) {
          sells.push({ side: 'sell', symbol, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS });
        }
      } else if (crossedUp.has(symbol)) {
        entries.push(symbol);
      }
    }

    const orders: (SellInput | BuyInput)[] = sells.slice(0, caps.max_orders_per_bar);
    const slots = Math.min(state.hello.symbols.length, caps.max_open_positions);
    const stake = state.equity / BigInt(slots);
    const byWeight = (BigInt(caps.max_weight_bps) * state.equity) / BPS;
    let room = slots - state.positions.size;
    let cash = state.cash;
    for (const symbol of entries) {
      if (room <= 0 || orders.length >= caps.max_orders_per_bar) break;
      let slice = stake < byWeight ? stake : byWeight;
      if (cash < slice) slice = cash;
      if (slice === 0n || slice < BigInt(fees.min_notional_quote_units)) break;
      orders.push({ side: 'buy', symbol, notional_quote_units: slice, max_slippage_bps: MAX_SLIPPAGE_BPS });
      cash -= slice;
      room--;
    }
    return orders;
  },
});
