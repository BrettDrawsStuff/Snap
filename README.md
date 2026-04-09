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

## Setup

```bash
pnpm install
```

### Local dev (no JFS verification)

```bash
SKIP_JFS_VERIFICATION=1 pnpm dev
```

Test at the [Farcaster Snap Emulator](https://farcaster.xyz/~/developers/snaps):
- Enter `http://localhost:3003`
- Use the emulator — it signs POST requests automatically

Verify the snap JSON directly:
```bash
curl -sS -H 'Accept: application/vnd.farcaster.snap+json' http://localhost:3003/
```

---

## Deployment

Deploy anywhere that runs Node.js. Recommended options:

### Vercel

```bash
# Install Vercel CLI
npm i -g vercel
vercel deploy
```

Set environment variable in Vercel dashboard:
```
SNAP_PUBLIC_BASE_URL=https://your-deployment.vercel.app
```

### Railway / Render / Fly.io

Set `SNAP_PUBLIC_BASE_URL` to your deployment origin.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `SNAP_PUBLIC_BASE_URL` | In production | Your deployment URL, no trailing slash |
| `SKIP_JFS_VERIFICATION` | Dev only | Set to `1` to skip JFS signature checks |
| `PORT` | Optional | HTTP port (default: `3003`) |

---

## Snap Structure

### Main View (`/?view=main` or `/`)
- Artwork GIF preview
- Current bid + leading bidder address
- Time remaining
- **Place Bid** (opens Manifold)
- **View Bids** (navigates to bid history)

### Bids View (`/?view=bids`)
- Bid count badge
- Up to 5 most recent bids with amount, shortened address, and time ago
- **Back to Auction** button

---

## Notes on the Manifold API

Bids are fetched from `apps.api.manifold.xyz/v1/marketplace/listings/{LISTING_ID}/bids`.

This is the same API Manifold's own Gallery widgets use. If the API shape changes or
the listing ID changes, update the `LISTING_ID` constant in `src/index.ts`.

The snap gracefully handles API failures — if Manifold is unreachable, the main card
still renders with "No bids yet" and the Place Bid link always works.

---

## Contract Details

- **Creator contract:** `0xb58b21f2A0c35A190a05CA7A28781B8ffcCb71B1`
- **Listing ID:** `4068856048`
- **Network:** Ethereum mainnet (chainId 1)
- **Manifold URL:** https://manifold.xyz/@brettdrawsstuff/id/4068856048
