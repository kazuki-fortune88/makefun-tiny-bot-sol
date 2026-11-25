# Tiny Trend Bot — Beat Buy-and-Hold on Solana


[![make.fun](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1.svg)](https://make.fun/competition/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![rank](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/kazuki-fortune88/makefun-tiny-bot-sol/rank.svg)](https://make.fun/competition/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)
[![reward](https://make.fun/badge/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1/kazuki-fortune88/makefun-tiny-bot-sol/reward.svg)](https://make.fun/competition/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1)


> NOTE: `<owner>/<repo>` in the rank/reward badges above is a placeholder —
> the coordinator replaces it with the real GitHub owner/repo when uploading.


A long-only trend-following bot for the make.fun bounty
**"Tiny Bot, Easy $2: Beat Buy-and-Hold on Solana"**
(`u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1`).
It trades hourly bars of FARTCOIN, JITOSOL, POPCAT, RAY, SOL, WETH and WIF
via the `agent-fun/bars-replay/v1` protocol, with no network access.


## Strategy


Textbook EMA trend-following with fixed, round parameters — nothing fitted
to the dev window:


- **Trend:** EMA(12) vs EMA(26) of hourly closes (the classic MACD spans).
- **Enter** when the fast EMA crosses above the slow EMA *and* the close is
  above the slow EMA — but only once the cross has survived one more bar.
  A cross that reverses on the very next bar is a whipsaw, not a trend.
- **Exit** the whole position when the fast EMA crosses back below the slow
  EMA, or on a **−8% stop-loss** (cut losers early), or a **+25%
  take-profit** (bank a sharp hourly move before it reverses).
- **Sizing:** equity split evenly across the universe slots, capped at 25%
  of equity per symbol (the harness weight cap). Sells go first, then buys;
  each order caps slippage at 100 bps past the deciding close.
- **Guards:** zero-volume bars signal nothing; no orders during warm-up;
  deterministic float64 math only — no clock, environment or randomness —
  so the two grading runs produce identical action logs.


## Why it should be robust (not overfit)


The final window is 3 unseen days of prices *after* the deadline, so the dev
window cannot be trusted as a target. The bot therefore uses only the
direction of a widely used trend indicator plus round risk limits, instead of
parameters tuned to dev data. Its edge over buy-and-hold is structural, not
statistical: in a falling market it sits mostly in cash (no forced holding),
while in a rising market it rides the coins whose trend has actually turned
up. No grid search or parameter optimisation was run.


## Grade locally


From the kit directory:


```sh
node cli/makefun.mjs grade-local --kit . \
  --bot ~/workspace/makefun/entries/u-gorun-gadget-tiny-bot-easy-2-beat-a48f3ce1 \
  --driver docker
```


## Referral


Built with referral `4fxhr3y1`.


## License


MIT — see [LICENSE](LICENSE).

