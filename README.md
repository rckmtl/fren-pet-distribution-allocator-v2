# Fren Pet allocation calculator v2

Separate clone of the original calculator. Run with Node 22+: npm start, then open http://127.0.0.1:4174. npm test and npm run build validate it.

## Frozen data

web/frozen.json contains the captured report: 203 wallets, 1,404 eligible living pets, eligibility block 52479727 (2026-10-11 20:00:01 UTC). The activity range is 2023-11-10 through 2026-09-23 inclusive. Points, carrots and stake were read at Base block 51709326 (2026-09-23 23:59:59 UTC). Lootboxes, Explorer Points and shields retain their original completed values and provenance. The source seed SHA-256 is recorded in the frozen metadata.

These six fields and the wallet/pet cohort are loaded from the local bundled file. Every field has an individual fresh-source refresh button. V2 retains the captured cohort and dates; saved reports and seeds must match that cohort and those cutoffs, but may contain refreshed values. Changing weights, distribution total, precision and smoothing remains supported. Reports are only exported or saved through explicit controls.

## Remaining three fields

- Training camps: current api.pet.game trainingAtk + trainingDef for each captured pet, summed by wallet. These are cumulative levels, not date-filtered event counts.
- Potion use: historical getDna at block 51709326. Species codes 7 (sheep), 9 (penguin), 10 (dragon), 11 (monkey), 12 (panda), 13 (dog/doge) qualify; codes 0–6 and 8 do not. The mapping matches the game's client. Any qualifying pet sets its wallet to 1. Historical species requires the private Base RPC relay, not a full event scan; there is no current-species fallback.
- Revives: api.pet.game hibernateds.totalCount with loserId matching each captured living pet and createdAt within the captured activity range. Counts are summed by its captured wallet. This is the user's hibernation proxy, not independently verified purchase counts.

Load remaining 3 fields only runs these requests. Each field commits atomically after complete validation; failed fields are unavailable, never silently zero. Per-pet evidence is retained in v2 saves and verification seeds. Unselected fields are unaffected by failures or cancellation.

Hosted tool: https://fren-pet-distribution-allocator-v2.wavy-frog-6029.chatgpt.site/. BASE_RPC_URL is configured as a server secret; no key enters browser assets or exports. For local live potion reads, set it in a Git-ignored .env. No dependencies need installation. Requests are paced and retry rate limits.

Allocation math is unchanged: independent field budgets, exact decimal fractions, optional sqrt of the combined wallet share, and deterministic largest-remainder rounding. Seeds reproduce frozen data and both payout methods; their checksum is not an independent certification of source accuracy.

## Defaults and table controls

The initial distribution pool is 282,000, request speed is Normal, and final allocation uses sqrt smoothing. Compare both methods in the table; Sqrt amount is outlined. Select 25, 50, or 100 wallets per page, or jump to a page. Weighted contribution and unweighted field shares are separate views.

## Hosting

This repository needs a Node server or a Worker host for the API relays; static GitHub Pages alone does not support live refreshes. Run `npm start` locally, or `npm run build` to emit a Worker. Set `BASE_RPC_URL` as a server-side secret using a Chainnodes Base HTTPS endpoint. Never commit a real endpoint/key. The Sites project identity and deployment history are not included in this source export. To publish a separate Sites copy, register your own project before deploying.
