# An Ambient Morning — Farcaster Snap

A Farcaster Snap (v2.0) for **BrettDrawsStuff**'s 1/1 auction on Manifold.

Renders as an interactive embed in Farcaster casts with:
- Live artwork preview
- Current bid & leading bidder
- Countdown timer
- **Place Bid** → links out to Manifold auction page
- **View Bids** → in-snap bid history view (last 5 bids, auto-refreshes on tap)

---

## Stack

- **Hono** — lightweight HTTP framework
- **@farcaster/snap-hono** — snap handler + JFS auth
- **Manifold Marketplace API** — live bid data from `apps.api.manifold.xyz`

---

## File Structure

```
index.ts        ← main snap server
package.json
tsconfig.json
README.md
Thumb1.png      ← artwork thumbnail
```

---

## Deployment

This snap is deployed on **Vercel** via GitHub. Any commit to `main` triggers an automatic redeploy.

### Environment Variables

Set these in the Vercel dashboard under Settings → Environment Variables:

| Variable | Required | Description |
|---|---|---|
| `SNAP_PUBLIC_BASE_URL` | Yes | Your Vercel deployment URL, no trailing slash |
| `SKIP_JFS_VERIFICATION` | Dev only | Set to `1` to skip JFS signature checks |
| `PORT` | Optional | HTTP port (default: `3003`) |

### Vercel Settings

- **Deployment Protection** must be set to **No protection** (Settings → Deployment Protection) — otherwise Farcaster clients will get a 403 and the snap won't load.

---

## Local Dev

If you have Node.js and pnpm installed:

```bash
pnpm install
SKIP_JFS_VERIFICATION=1 pnpm dev
# → http://localhost:3003
```

Test at the [Farcaster Snap Emulator](https://farcaster.xyz/~/developers/snaps) — enter `http://localhost:3003`.

Verify the snap JSON directly:
```bash
curl -sS -H 'Accept: application/vnd.farcaster.snap+json' http://localhost:3003/
```

---

## Snap Structure

### Main View (`/?view=main` or `/`)
- 16:9 artwork thumbnail
- Current bid + leading bidder address
- Time remaining
- **Place Bid** (opens Manifold)
- **View Bids** (navigates to bid history)

### Bids View (`/?view=bids`)
- Bid count badge
- Up to 5 highest bids with amount, shortened address, and time ago
- **Back to Auction** button

---

## Updating for a New Drop

The only constants that need changing for a new auction are at the top of `index.ts`:

```ts
const MANIFOLD_URL = "https://manifold.xyz/@brettdrawsstuff/id/..."
const LISTING_ID = "..."
const ARTWORK_GIF = "https://raw.githubusercontent.com/BrettDrawsStuff/Snap/main/Thumb1.png"
```

Also replace `Thumb1.png` in the repo with the new artwork thumbnail.

---

## Notes on the Manifold API

Bids are fetched from `apps.api.manifold.xyz/v1/marketplace/listings/{LISTING_ID}/bids`.

The snap gracefully handles API failures — if Manifold is unreachable, the main card still renders with "No bids yet" and the Place Bid link always works.

---

## Contract Details

- **Creator contract:** `0xb58b21f2A0c35A190a05CA7A28781B8ffcCb71B1`
- **Listing ID:** `4068856048`
- **Network:** Ethereum mainnet (chainId 1)
- **Manifold URL:** https://manifold.xyz/@brettdrawsstuff/id/4068856048
