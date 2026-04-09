import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { registerSnapHandler } from "@farcaster/snap-hono";

// ── Constants ────────────────────────────────────────────────────────────────

const MANIFOLD_URL =
  "https://manifold.xyz/@brettdrawsstuff/id/4068856048";

// The Manifold marketplace listing ID — extracted from the URL path (4068856048)
// and the creator contract address.
const LISTING_ID = "4068856048";
const CONTRACT_ADDRESS = "0xb58b21f2A0c35A190a05CA7A28781B8ffcCb71B1";
const NETWORK = 1; // Ethereum mainnet

// Manifold marketplace API base — used by their own gallery widgets
const MANIFOLD_API_BASE = "https://apps.api.manifold.xyz";

// ── Types ────────────────────────────────────────────────────────────────────

interface ManifoldBid {
  bidder: string;
  bidderAddress?: string;
  amount: string; // in wei
  timestamp: number;
}

interface ManifoldListing {
  id: string;
  currentBidAmount?: string; // in wei
  highestBidder?: string;
  endTime?: number;
  startingPrice?: string; // in wei
  bids?: ManifoldBid[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function snapBaseUrl(request: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");

  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const host = (forwardedHost ?? hostHeader)?.split(",")[0].trim();
  const isLoopback =
    host !== undefined &&
    /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const forwardedProto = request.headers.get("x-forwarded-proto");
  const proto = forwardedProto
    ? forwardedProto.split(",")[0].trim().toLowerCase()
    : isLoopback
    ? "http"
    : "https";
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return `http://localhost:${process.env.PORT ?? "3003"}`;
}

/** Convert wei string to a human-readable ETH string, e.g. "0.25 ETH" */
function weiToEth(weiStr: string): string {
  try {
    const wei = BigInt(weiStr);
    const eth = Number(wei) / 1e18;
    return `${eth % 1 === 0 ? eth.toFixed(0) : eth.toPrecision(4)} ETH`;
  } catch {
    return "? ETH";
  }
}

/** Shorten a 0x address for display: 0x1234…abcd */
function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

/** Fetch listing + bids from Manifold's marketplace API */
async function fetchListing(): Promise<ManifoldListing | null> {
  try {
    // Manifold Gallery API — listings by ID
    const res = await fetch(
      `${MANIFOLD_API_BASE}/v1/marketplace/listings/${LISTING_ID}?network=${NETWORK}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) {
      // Fallback: try by token contract
      const res2 = await fetch(
        `${MANIFOLD_API_BASE}/v1/marketplace/listings?contract=${CONTRACT_ADDRESS}&network=${NETWORK}`,
        { headers: { Accept: "application/json" } }
      );
      if (!res2.ok) return null;
      const data2 = await res2.json();
      const listings = Array.isArray(data2) ? data2 : data2.listings ?? [];
      return listings[0] ?? null;
    }
    return await res.json();
  } catch {
    return null;
  }
}

/** Fetch bids for the listing */
async function fetchBids(): Promise<ManifoldBid[]> {
  try {
    const res = await fetch(
      `${MANIFOLD_API_BASE}/v1/marketplace/listings/${LISTING_ID}/bids?network=${NETWORK}`,
      { headers: { Accept: "application/json" } }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) ? data : data.bids ?? [];
  } catch {
    return [];
  }
}

// ── Snap Pages ───────────────────────────────────────────────────────────────

/**
 * Main auction card — shows current bid, time remaining, and two action buttons.
 */
function mainPage(base: string, listing: ManifoldListing | null) {
  const currentBid = listing?.currentBidAmount
    ? weiToEth(listing.currentBidAmount)
    : listing?.startingPrice
    ? `Reserve: ${weiToEth(listing.startingPrice)}`
    : "No bids yet";

  const highestBidder = listing?.highestBidder
    ? shortAddr(listing.highestBidder)
    : null;

  const timeLabel = (() => {
    if (!listing?.endTime) return "Auction live";
    const msLeft = listing.endTime * 1000 - Date.now();
    if (msLeft <= 0) return "Auction ended";
    const h = Math.floor(msLeft / 3_600_000);
    const m = Math.floor((msLeft % 3_600_000) / 60_000);
    if (h >= 48) return `${Math.floor(h / 24)}d remaining`;
    if (h >= 1) return `${h}h ${m}m remaining`;
    return `${m}m remaining`;
  })();

  return {
    version: "2.0" as const,
    theme: { accent: "teal" as const },
    ui: {
      root: "page",
      elements: {
        page: {
          type: "stack" as const,
          props: { gap: "md" as const },
          children: [
            "header",
            "artwork-img",
            "sep1",
            "bid-row",
            "time-text",
            "sep2",
            "actions",
          ],
        },

        // Title block
        header: {
          type: "item" as const,
          props: {
            title: "An Ambient Morning",
            description: "1/1 · BrettDrawsStuff · Manifold",
          },
          children: ["live-badge"],
        },
        "live-badge": {
          type: "badge" as const,
          props: { label: "Live", color: "green" as const, icon: "zap" as const },
        },

        // Artwork thumbnail — links to Manifold GIF/preview
        "artwork-img": {
          type: "image" as const,
          props: {
            url: "https://assets.manifold.xyz/original/5559bbaba1ce510f5dcb0b5fdac4b0a178f70e782c0701166d2d64d292fcff26.gif",
            aspect: "1:1" as const,
            alt: "An Ambient Morning by BrettDrawsStuff",
          },
        },

        sep1: { type: "separator" as const, props: {} },

        // Current bid info
        "bid-row": {
          type: "item" as const,
          props: {
            title: currentBid,
            description: highestBidder ? `Leading bid by ${highestBidder}` : "Be the first to bid",
          },
          children: ["eth-icon"],
        },
        "eth-icon": {
          type: "icon" as const,
          props: { name: "wallet" as const, color: "accent" as const },
        },

        "time-text": {
          type: "text" as const,
          props: { content: timeLabel, size: "sm" as const, align: "center" as const },
        },

        sep2: { type: "separator" as const, props: {} },

        // Action buttons
        actions: {
          type: "stack" as const,
          props: { direction: "horizontal" as const, gap: "sm" as const },
          children: ["bid-btn", "bids-btn"],
        },
        "bid-btn": {
          type: "button" as const,
          props: { label: "Place Bid", variant: "primary" as const, icon: "external-link" as const },
          on: {
            press: {
              action: "open_url" as const,
              params: { target: MANIFOLD_URL },
            },
          },
        },
        "bids-btn": {
          type: "button" as const,
          props: { label: "View Bids", icon: "trending-up" as const },
          on: {
            press: {
              action: "submit" as const,
              params: { target: `${base}/?view=bids` },
            },
          },
        },
      },
    },
  };
}

/**
 * Bids list page — shows recent bids in descending order.
 */
function bidsPage(base: string, bids: ManifoldBid[], listing: ManifoldListing | null) {
  const sorted = [...bids].sort((a, b) => b.timestamp - a.timestamp).slice(0, 5);

  const currentBid = listing?.currentBidAmount
    ? weiToEth(listing.currentBidAmount)
    : null;

  const elements: Record<string, unknown> = {
    page: {
      type: "stack",
      props: { gap: "md" },
      children: ["header", "sep1", ...(sorted.length > 0 ? bidChildIds(sorted) : ["no-bids"]), "sep2", "back-btn"],
    },
    header: {
      type: "item",
      props: {
        title: "Bid History",
        description: currentBid ? `Current bid: ${currentBid}` : "An Ambient Morning",
      },
      children: ["count-badge"],
    },
    "count-badge": {
      type: "badge",
      props: {
        label: `${bids.length} bid${bids.length !== 1 ? "s" : ""}`,
        color: "teal",
      },
    },
    sep1: { type: "separator", props: {} },
    sep2: { type: "separator", props: {} },
    "no-bids": {
      type: "text",
      props: {
        content: "No bids yet — be the first!",
        align: "center",
        size: "sm",
      },
    },
    "back-btn": {
      type: "button",
      props: { label: "Back to Auction", variant: "primary" as const, icon: "arrow-left" as const },
      on: {
        press: {
          action: "submit",
          params: { target: `${base}/?view=main` },
        },
      },
    },
  };

  // Add bid items
  sorted.forEach((bid, i) => {
    const id = `bid-${i}`;
    const badgeId = `badge-${i}`;
    const addr = bid.bidderAddress
      ? shortAddr(bid.bidderAddress)
      : bid.bidder
      ? shortAddr(bid.bidder)
      : "Unknown";
    const amount = weiToEth(bid.amount);
    const ago = (() => {
      const s = Math.floor((Date.now() - bid.timestamp * 1000) / 1000);
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.floor(s / 60)}m ago`;
      return `${Math.floor(s / 3600)}h ago`;
    })();

    elements[id] = {
      type: "item",
      props: { title: amount, description: `${addr} · ${ago}` },
      children: [badgeId],
    };
    elements[badgeId] = {
      type: "badge",
      props: {
        label: i === 0 ? "Top" : `#${i + 1}`,
        color: i === 0 ? "green" : "gray",
        variant: i === 0 ? "default" : "outline",
      },
    };
  });

  return {
    version: "2.0" as const,
    theme: { accent: "teal" as const },
    ui: {
      root: "page",
      elements,
    },
  };
}

function bidChildIds(bids: ManifoldBid[]): string[] {
  return bids.slice(0, 5).flatMap((_, i) => [`bid-${i}`]);
}

// ── App ──────────────────────────────────────────────────────────────────────

const app = new Hono();

registerSnapHandler(
  app,
  async (ctx) => {
    const base = snapBaseUrl(ctx.request);
    const url = new URL(ctx.request.url);
    const view = url.searchParams.get("view") ?? "main";

    if (view === "bids") {
      const [listing, bids] = await Promise.all([fetchListing(), fetchBids()]);
      return bidsPage(base, bids, listing);
    }

    // Default: main auction card
    const listing = await fetchListing();
    return mainPage(base, listing);
  },
  {
    skipJFSVerification: process.env.SKIP_JFS_VERIFICATION === "1",
  }
);

// Fallback HTML for normal browser visits
app.get("/", async (c, next) => {
  const accept = c.req.header("Accept") ?? "";
  if (accept.includes("application/vnd.farcaster.snap+json")) return next();

  return c.html(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>An Ambient Morning — BrettDrawsStuff</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0a0a0a; color: #f0f0f0;
           display: flex; flex-direction: column; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; gap: 1.5rem; }
    h1 { font-size: 1.5rem; margin: 0; }
    p  { color: #888; margin: 0; }
    a  { color: #00AC96; font-weight: 600; text-decoration: none; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <h1>An Ambient Morning</h1>
  <p>1/1 · BrettDrawsStuff · Manifold</p>
  <a href="${MANIFOLD_URL}" target="_blank" rel="noopener">View &amp; Bid on Manifold →</a>
  <p style="font-size:0.75rem;color:#555">
    This URL serves as a Farcaster Snap when embedded in a cast.
  </p>
</body>
</html>`);
});

const port = Number(process.env.PORT ?? 3003);
console.log(`🎨 Ambient Morning Snap running on http://localhost:${port}`);

serve({ fetch: app.fetch, port });
