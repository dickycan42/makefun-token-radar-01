# Token Radar — pre-token protocols ranked by implied value

A radar for the make.fun `token-radar-01` bounty. It reads a frozen DefiLlama
snapshot of 758 protocols, finds the ones that record no token yet, ranks them
by an implied launch value derived from the snapshot's own figures, and hands
you a farm plan for each — as a static dashboard that runs with no network.

## What it answers

Which pre-token protocol is worth farming next, and what do I do about it?
The board covers all 40 watchlist protocols plus 160 early finds below the
$50M watchlist floor, picked by TVL — 200 rows in total. Protocols whose token
already trades are set aside in a separate live-token view, shown with the
market's own capitalisation, never mixed into the ranking.

## The model (radar-2)

Every row is scored by `impliedValue` in `lib/model.ts`, from that protocol's
own snapshot figures only — never from a hand-kept list of names:

```
base      = tvl_usd × 0.32
growth    = clamp(change_7d, −50%, +150%) × 0.6 weight
maturity  = 0.55 + min(age_days, 1460) / 1460 × 0.45   (unknown age: 270 days)
breadth   = 1 + 0.03 × extra chains (max 5)
category  = per-category durability factor (1.00 Dexs/Lending … 0.85 bridges)
implied   = round(base × growth × maturity × breadth × category)
```

Farm plans are built from the same record: capital is sized to TVL
($75–$500 a position), the hold period to age (45–90 days), and the core
action to the protocol's category and main chain. Every step states what it
costs and how long it takes.

## How to run it

```sh
mkdir -p out
MAKEFUN_OUTPUT_DIR=out node main.ts --input path/to/snapshot.json
```

Node 22, standard library only, no network at runtime. The program writes
`out/board.json` (the ranked board), `out/data.js` (the dashboard's dataset),
copies of `dashboard/` and `screenshots/`, and `out/dossier.json` (built with
the vendored `vendor/makefun-board.ts`). Two runs over the same snapshot write
byte-identical output.

## The dashboard

Open `out/dashboard/index.html` in a browser. It is sortable (rank, implied
value, TVL, growth, age), filterable (category, chain, free-text search,
minimum TVL), and every row opens a detail view with the full figures, the
model breakdown and the six-step farm plan. The live-token view lists the
largest protocols that already trade.

## Caveats

An implied value is this radar's own claim, not a prediction that a token
will launch, or when. "Records no token" means the snapshot carries no market
cap, CoinGecko id or symbol for a protocol — not proof that none exists.

## License

MIT — see `LICENSE`.
