# Genie

Wishlist site at daniyalzia.co.uk/genie: make a list of things you want (with links), share one link, and people pick what to get you. Visitors grant wishes without an account, anonymously, so nobody doubles up. The owner sees what was granted only after the day, and never who.

- `client/`: the site (Vite + React)
- `server/`: the API on plain `node:http` + TypeScript, Postgres, and GenieBot, which reads a pasted link's name and price
- `shared/`: types and limits both sides use
- `docs/compliance/`: privacy and online safety records, and how reports are handled
- `PLAN.md`: the plan, decisions and launch gates

Checks: `npm run typecheck`, `npm run build`, `cd server && npx tsx check-unfurl.ts` (no database needed) and `npm run check` (needs the `genie_dev` database).

## Licence

MIT, see [LICENSE](LICENSE).
