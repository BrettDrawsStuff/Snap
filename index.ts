import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { registerSnapHandler } from "@farcaster/snap-hono";
import type { SnapElementInput, SnapHandlerResult } from "@farcaster/snap";

const MANIFOLD_URL = "https://manifold.xyz/@brettdrawsstuff/id/4068856048";
const LISTING_ID = "4068856048";
const CONTRACT_ADDRESS = "0xb58b21f2A0c35A190a05CA7A28781B8ffcCb71B1";
const NETWORK = 1;
const MANIFOLD_API_BASE = "https://apps.api.manifold.xyz";
const ARTWORK_GIF =
  "https://assets.manifold.xyz/original/5559bbaba1ce510f5dcb0b5fdac4b0a178f70e782c0701166d2d64d292fcff26.gif";

interface ManifoldBid {
  bidder?: string;
  bidderAddress?: string;
  amount: string;
  timestamp: number;
}
interface ManifoldListing {
  currentBidAmount?: string;
  highestBidder?: string;
  endTime?: number;
  startingPrice?: string;
}

function snapBaseUrl(request: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const host = (forwardedHost ?? hostHeader)?.split(",")[0].trim();
  const isLoopback = host !== undefined && /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase() ?? (isLoopback ? "http" : "https");
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return `http://localhost:${process.env.PORT ?? "3003"}`;
}

function weiToEth(weiStr: string): string {
  try {
    const eth = Number(BigInt(weiStr)) / 1e18;
    return `${eth % 1 === 0 ? eth.toFixed(0) : parseFloat(eth.toPrecision(4))} ETH`;
  } catch { return "? ETH"; }
}

function shortAddr(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts * 1000) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function timeRemaining(endTs: number): string {
  const ms = endTs * 1000 - Date.now();
  if (ms <= 0) return "Auction ended";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d remaining`;
  if (h >= 1) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

async function fetchListing(): Promise<ManifoldListing | null> {
  try {
    const r = await fetch(`${MANIFOLD_API_BASE}/v1/marketplace/listings/${LISTING_ID}?network=${NETWORK}`, { headers: { Accept: "application/json" } });
    if (r.ok) return await r.json() as ManifoldListing;
    const r2 = await fetch(`${MANIFOLD_API_BASE}/v1/marketplace/listings?contract=${CONTRACT_ADDRESS}&network=${NETWORK}`, { headers: { Accept: "application/json" } });
    if (!r2.ok) return null;
    const d = await r2.json() as ManifoldListing[] | { listings: ManifoldListing[] };
    return (Array.isArray(d) ? d : d.listings ?? [])[0] ?? null;
  } catch { return null; }
}

async function fetchBids(): Promise<ManifoldBid[]> {
  try {
    const r = await fetch(`${MANIFOLD_API_BASE}/v1/marketplace/listings/${LISTING_ID}/bids?network=${NETWORK}`, { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const d = await r.json() as ManifoldBid[] | { bids: ManifoldBid[] };
    return Array.isArray(d) ? d : d.bids ?? [];
  } catch { return []; }
}

function mainPage(base: string, listing: ManifoldListing | null): SnapHandlerResult {
  const currentBid = listing?.currentBidAmount
    ? weiToEth(listing.currentBidAmount)
    : listing?.startingPrice
    ? `Reserve: ${weiToEth(listing.startingPrice)}`
    : "No bids yet";

  const bidDesc = listing?.highestBidder
    ? `Leading bid · ${shortAddr(listing.highestBidder)}`
    : "Be the first to bid";

  const timer = listing?.endTime ? timeRemaining(listing.endTime) : "Auction live";

  const elements: Record<string, SnapElementInput> = {
    page: { type: "stack", props: { gap: "md" }, children: ["header", "artwork", "sep1", "bid-row", "timer", "sep2", "actions"] },
    header: { type: "item", props: { title: "An Ambient Morning", description: "1/1 · BrettDrawsStuff · Manifold" }, children: ["live-badge"] },
    "live-badge": { type: "badge", props: { label: "Live", color: "green", icon: "zap" } },
    artwork: { type: "image", props: { url: ARTWORK_GIF, aspect: "1:1", alt: "An Ambient Morning by BrettDrawsStuff" } },
    sep1: { type: "separator", props: {} },
    "bid-row": { type: "item", props: { title: currentBid, description: bidDesc }, children: ["wallet-icon"] },
    "wallet-icon": { type: "icon", props: { name: "wallet", color: "accent" } },
    timer: { type: "text", props: { content: timer, size: "sm", align: "center" } },
    sep2: { type: "separator", props: {} },
    actions: { type: "stack", props: { direction: "horizontal", gap: "sm" }, children: ["bid-btn", "bids-btn"] },
    "bid-btn": { type: "button", props: { label: "Place Bid", variant: "primary", icon: "external-link" }, on: { press: { action: "open_url", params: { target: MANIFOLD_URL } } } },
    "bids-btn": { type: "button", props: { label: "View Bids", icon: "trending-up" }, on: { press: { action: "submit", params: { target: `${base}/?view=bids` } } } },
  };

  return { version: "2.0", theme: { accent: "teal" }, ui: { root: "page", elements } };
}

function bidsPage(base: string, bids: ManifoldBid[], listing: ManifoldListing | null): SnapHandlerResult {
  const top = [...bids].sort((a, b) => {
    try { return Number(BigInt(b.amount) - BigInt(a.amount)); } catch { return 0; }
  }).slice(0, 5);

  const currentBid = listing?.currentBidAmount ? weiToEth(listing.currentBidAmount) : null;
  const bodyChildren = top.length > 0 ? top.map((_, i) => `bid-${i}`) : ["no-bids"];

  const elements: Record<string, SnapElementInput> = {
    page: { type: "stack", props: { gap: "md" }, children: ["header", "sep1", ...bodyChildren, "sep2", "back-btn"] },
    header: { type: "item", props: { title: "Bid History", description: currentBid ? `Current: ${currentBid}` : "An Ambient Morning" }, children: ["count-badge"] },
    "count-badge": { type: "badge", props: { label: `${bids.length} bid${bids.length !== 1 ? "s" : ""}`, color: "teal" } },
    sep1: { type: "separator", props: {} },
    "no-bids": { type: "text", props: { content: "No bids yet — be the first!", align: "center", size: "sm" } },
    sep2: { type: "separator", props: {} },
    "back-btn": { type: "button", props: { label: "Back to Auction", variant: "primary", icon: "arrow-left" }, on: { press: { action: "submit", params: { target: `${base}/?view=main` } } } },
  };

  top.forEach((bid, i) => {
    const addr = bid.bidderAddress ? shortAddr(bid.bidderAddress) : bid.bidder ? shortAddr(bid.bidder) : "Unknown";
    elements[`bid-${i}`] = { type: "item", props: { title: weiToEth(bid.amount), description: `${addr}${bid.timestamp ? ` · ${timeAgo(bid.timestamp)}` : ""}` }, children: [`badge-${i}`] };
    elements[`badge-${i}`] = { type: "badge", props: { label: i === 0 ? "Top" : `#${i + 1}`, color: i === 0 ? "green" : "gray", variant: i === 0 ? "default" : "outline" } };
  });

  return { version: "2.0", theme: { accent: "teal" }, ui: { root: "page", elements } };
}

const app = new Hono();

// Allow Farcaster clients and the emulator to fetch this snap
app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"] }));

registerSnapHandler(
  app,
  async (ctx) => {
    const base = snapBaseUrl(ctx.request);
    const view = new URL(ctx.request.url).searchParams.get("view") ?? "main";
    if (view === "bids") {
      const [listing, bids] = await Promise.all([fetchListing(), fetchBids()]);
      return bidsPage(base, bids, listing);
    }
    return mainPage(base, await fetchListing());
  },
  {
    skipJFSVerification: process.env.SKIP_JFS_VERIFICATION === "1",
    fallbackHtml: `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>An Ambient Morning — BrettDrawsStuff</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:system-ui,sans-serif;background:#0a0a0a;color:#f0f0f0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;gap:1.25rem;padding:2rem;text-align:center}h1{font-size:1.5rem}p{color:#888;font-size:.9rem}a{color:#00AC96;font-weight:600;text-decoration:none}a:hover{text-decoration:underline}small{color:#444;font-size:.7rem}</style></head><body><h1>An Ambient Morning</h1><p>1/1 · BrettDrawsStuff · Manifold</p><a href="${MANIFOLD_URL}" target="_blank" rel="noopener">View &amp; Bid on Manifold →</a><small>This URL serves as a Farcaster Snap when embedded in a cast.</small></body></html>`,
  }
);

const port = Number(process.env.PORT ?? 3003);
console.log(`🎨 Ambient Morning Snap → http://localhost:${port}`);
serve({ fetch: app.fetch, port });
