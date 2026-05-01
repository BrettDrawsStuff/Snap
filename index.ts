import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import { registerSnapHandler } from "@farcaster/snap-hono";
import type { SnapUIElement, SnapHandlerResult } from "@farcaster/snap";

// ── Constants ────────────────────────────────────────────────────────────────

const MANIFOLD_URL = "https://manifold.xyz/@brettdrawsstuff/id/4068856048";
const LISTING_ID = 4068856048n;
const ARTWORK_URL = "https://raw.githubusercontent.com/BrettDrawsStuff/Snap/main/Thumb1.png";

// Manifold Marketplace Core (mainnet)
const MARKETPLACE_CONTRACT = "0x3a3548e060be10c2614d0a4cb0c03cc9093fd799";

// Public Ethereum RPC — no API key needed
const ETH_RPC = "https://eth.llamarpc.com";

// keccak256("BidPlaced(uint256,address,uint256,uint256)")
const BID_PLACED_TOPIC = "0x4af288a6b3b84e9bc2e01cd44cfd5a85f71f62c06e29e8fb20a3dbdc5f08e26a";

// Function selectors
const GET_BID_SELECTOR      = "0x91ef5edb"; // getBid(uint256)
const GET_LISTING_SELECTOR  = "0x107a274a"; // getListing(uint256)

// ── Types ────────────────────────────────────────────────────────────────────

interface OnChainBid {
  bidder: string;
  amount: bigint;
  timestamp: number;
}

interface OnChainListing {
  currentBid: bigint;
  highestBidder: string;
  endTime: bigint;
  startingPrice: bigint;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function snapBaseUrl(request: Request): string {
  const fromEnv = process.env.SNAP_PUBLIC_BASE_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const hostHeader = request.headers.get("host");
  const host = (forwardedHost ?? hostHeader)?.split(",")[0].trim();
  const isLoopback = host !== undefined && /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/.test(host);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0].trim().toLowerCase()
    ?? (isLoopback ? "http" : "https");
  if (host) return `${proto}://${host}`.replace(/\/$/, "");
  return `http://localhost:${process.env.PORT ?? "3003"}`;
}

function weiToEth(wei: bigint): string {
  if (wei === 0n) return "0 ETH";
  const eth = Number(wei) / 1e18;
  return `${eth % 1 === 0 ? eth.toFixed(0) : parseFloat(eth.toPrecision(4))} ETH`;
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

function timeRemaining(endTs: bigint): string {
  const ms = Number(endTs) * 1000 - Date.now();
  if (ms <= 0) return "Auction ended";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}d remaining`;
  if (h >= 1) return `${h}h ${m}m remaining`;
  return `${m}m remaining`;
}

function encodeUint256(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

async function ethCall(to: string, data: string): Promise<string | null> {
  try {
    const res = await fetch(ETH_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to, data }, "latest"] }),
    });
    const json = await res.json() as { result?: string };
    return json.result ?? null;
  } catch { return null; }
}

async function ethGetLogs(address: string, topics: string[], fromBlock: string): Promise<Array<{ data: string; topics: string[]; blockNumber: string }>> {
  try {
    const res = await fetch(ETH_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{ address, topics, fromBlock, toBlock: "latest" }] }),
    });
    const json = await res.json() as { result?: Array<{ data: string; topics: string[]; blockNumber: string }> };
    return json.result ?? [];
  } catch { return []; }
}

async function getBlockTimestamp(blockNumber: string): Promise<number> {
  try {
    const res = await fetch(ETH_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBlockByNumber", params: [blockNumber, false] }),
    });
    const json = await res.json() as { result?: { timestamp: string } };
    return parseInt(json.result?.timestamp ?? "0", 16);
  } catch { return 0; }
}

// ── On-chain data ─────────────────────────────────────────────────────────────

async function fetchListing(): Promise<OnChainListing | null> {
  try {
    const [bidData, listingData] = await Promise.all([
      ethCall(MARKETPLACE_CONTRACT, GET_BID_SELECTOR + encodeUint256(LISTING_ID)),
      ethCall(MARKETPLACE_CONTRACT, GET_LISTING_SELECTOR + encodeUint256(LISTING_ID)),
    ]);

    if (!bidData || !listingData || bidData === "0x") return null;

    // getBid returns: address (32 bytes padded), uint256 amount
    const highestBidder = "0x" + bidData.slice(26, 66);
    const currentBid = BigInt("0x" + bidData.slice(66, 130));

    // getListing struct — decode 32-byte slots
    const raw = listingData.slice(2);
    const slots = (raw.match(/.{64}/g) ?? []).map(s => BigInt("0x" + s));

    // Manifold struct layout: [listingId, tokenContract, tokenId, startingPrice, reservePrice, endTime, ...]
    const startingPrice = slots[3] ?? 0n;
    const endTime       = slots[5] ?? 0n;

    return { currentBid, highestBidder, endTime, startingPrice };
  } catch { return null; }
}

async function fetchBids(): Promise<OnChainBid[]> {
  try {
    const listingTopic = "0x" + encodeUint256(LISTING_ID);

    // Start from block 19000000 (~Feb 2024) to keep log range tight
    const logs = await ethGetLogs(
      MARKETPLACE_CONTRACT,
      [BID_PLACED_TOPIC, listingTopic],
      "0x122A480"
    );

    const bids = await Promise.all(
      logs.map(async (log) => {
        const bidder = "0x" + log.topics[2].slice(26);
        const amount = BigInt("0x" + log.data.slice(2, 66));
        const timestamp = await getBlockTimestamp(log.blockNumber);
        return { bidder, amount, timestamp };
      })
    );

    return bids.sort((a, b) => (b.amount > a.amount ? 1 : -1));
  } catch { return []; }
}

// ── Snap Pages ───────────────────────────────────────────────────────────────

function mainPage(base: string, listing: OnChainListing | null): SnapHandlerResult {
  const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
  const hasBid = listing && listing.currentBid > 0n && listing.highestBidder !== ZERO_ADDR;

  const currentBid = hasBid
    ? weiToEth(listing!.currentBid)
    : listing?.startingPrice && listing.startingPrice > 0n
    ? `Reserve: ${weiToEth(listing.startingPrice)}`
    : "No bids yet";

  const bidDesc = hasBid
    ? `Leading bid · ${shortAddr(listing!.highestBidder)}`
    : "Be the first to bid";

  const timer = listing?.endTime && listing.endTime > 0n
    ? timeRemaining(listing.endTime)
    : "Auction live";

  const elements: Record<string, SnapUIElement> = {
    page:          { type: "stack",  props: { gap: "sm" }, children: ["header", "artwork", "bid-row", "timer", "actions"] },
    header:        { type: "item",   props: { title: "An Ambient Morning", description: "1/1 · BrettDrawsStuff · Manifold" }, children: ["live-badge"] },
    "live-badge":  { type: "badge",  props: { label: "Live", color: "green", icon: "zap" } },
    artwork:       { type: "image",  props: { url: ARTWORK_URL, aspect: "16:9", alt: "An Ambient Morning by BrettDrawsStuff" } },
    "bid-row":     { type: "item",   props: { title: currentBid, description: bidDesc }, children: ["wallet-icon"] },
    "wallet-icon": { type: "icon",   props: { name: "wallet", color: "accent" } },
    timer:         { type: "text",   props: { content: timer, size: "sm", align: "center" } },
    actions:       { type: "stack",  props: { direction: "horizontal", gap: "sm" }, children: ["bid-btn", "bids-btn"] },
    "bid-btn":     { type: "button", props: { label: "Place Bid", variant: "primary", icon: "external-link" }, on: { press: { action: "open_url",  params: { target: MANIFOLD_URL } } } },
    "bids-btn":    { type: "button", props: { label: "View Bids", icon: "trending-up" },                       on: { press: { action: "submit",    params: { target: `${base}/?view=bids` } } } },
  };

  return { version: "1.0", theme: { accent: "teal" }, ui: { root: "page", elements } };
}

function bidsPage(base: string, bids: OnChainBid[], listing: OnChainListing | null): SnapHandlerResult {
  const top = bids.slice(0, 5);
  const hasBid = listing && listing.currentBid > 0n;
  const currentBid = hasBid ? weiToEth(listing!.currentBid) : null;
  const bodyChildren = top.length > 0 ? top.map((_, i) => `bid-${i}`) : ["no-bids"];

  const elements: Record<string, SnapUIElement> = {
    page:          { type: "stack",  props: { gap: "sm" }, children: ["header", "sep1", ...bodyChildren, "sep2", "back-btn"] },
    header:        { type: "item",   props: { title: "Bid History", description: currentBid ? `Current: ${currentBid}` : "An Ambient Morning" }, children: ["count-badge"] },
    "count-badge": { type: "badge",  props: { label: `${bids.length} bid${bids.length !== 1 ? "s" : ""}`, color: "teal" } },
    sep1:          { type: "separator", props: {} },
    "no-bids":     { type: "text",   props: { content: "No bids yet — be the first!", align: "center", size: "sm" } },
    sep2:          { type: "separator", props: {} },
    "back-btn":    { type: "button", props: { label: "Back to Auction", variant: "primary", icon: "arrow-left" }, on: { press: { action: "submit", params: { target: `${base}/?view=main` } } } },
  };

  top.forEach((bid, i) => {
    elements[`bid-${i}`]  = { type: "item",  props: { title: weiToEth(bid.amount), description: `${shortAddr(bid.bidder)}${bid.timestamp ? ` · ${timeAgo(bid.timestamp)}` : ""}` }, children: [`badge-${i}`] };
    elements[`badge-${i}`]= { type: "badge", props: { label: i === 0 ? "Top" : `#${i + 1}`, color: i === 0 ? "green" : "gray", variant: i === 0 ? "default" : "outline" } };
  });

  return { version: "1.0", theme: { accent: "teal" }, ui: { root: "page", elements } };
}

// ── App ──────────────────────────────────────────────────────────────────────

const app = new Hono();

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
