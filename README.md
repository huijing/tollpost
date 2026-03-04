# TollPost

Blog posts with a toll for machines.

TollPost is a blog template where humans read for free and AI agents pay per request. Built with [Astro](https://astro.build) and Circle Gateway [Nanopayments](https://developers.circle.com/gateway/nanopayments).

## How it works

Your blog serves content two ways:

- `/blog/my-post` — Static HTML pages, free for anyone in a browser
- `/api/posts/my-post` — JSON API, gated behind the [x402 payment protocol](https://www.x402.org/)

When an AI agent requests content from the API, it gets a `402 Payment Required` response. The agent signs a USDC payment off-chain (no gas fees), retries the request, and receives the article as structured JSON. Humans visiting the same article in a browser see a normal blog page with no paywall.

```
Agent                            TollPost                         Circle Gateway
  |                                 |                                   |
  |  GET /api/posts/my-post         |                                   |
  |-------------------------------->|                                   |
  |                                 |                                   |
  |  402 Payment Required           |                                   |
  |  PAYMENT-REQUIRED: (price)      |                                   |
  |<--------------------------------|                                   |
  |                                 |                                   |
  |  [signs payment off-chain]      |                                   |
  |                                 |                                   |
  |  GET /api/posts/my-post         |                                   |
  |  Payment-Signature: (signed)    |                                   |
  |-------------------------------->|                                   |
  |                                 |  settle payment                   |
  |                                 |---------------------------------->|
  |                                 |  success                          |
  |                                 |<----------------------------------|
  |  200 OK                         |                                   |
  |  { title, content, payment }    |                                   |
  |<--------------------------------|                                   |
```

Payments are batched and settled on-chain later by Circle Gateway, so there are no gas fees per request.

## For AI agent developers

If you're building an agent that consumes TollPost content, here's what you need:

```typescript
import { GatewayClient } from "@circle-fin/x402-batching/client";

const client = new GatewayClient({
  chain: "baseSepolia",
  privateKey: process.env.AGENT_WALLET_KEY,
});

// One-time: deposit USDC into Gateway
await client.deposit("5");

// Pay for an article — handles the full 402 flow automatically
const { data } = await client.pay("https://tollpost.com/api/posts/how-tollpost-works");

console.log(data.title); // "How TollPost Works"
console.log(data.content); // Full markdown content
```

`client.pay()` does everything: makes the request, reads the 402 response, signs the payment, retries, and returns the content. Your agent doesn't need to understand the protocol.

The JSON response contains:

```json
{
  "id": "how-tollpost-works",
  "title": "How TollPost Works",
  "description": "...",
  "pubDate": "2024-06-01T00:00:00.000Z",
  "content": "Full markdown content...",
  "payment": {
    "payer": "0x...",
    "transaction": "...",
    "network": "eip155:84532"
  }
}
```

## Setup

### Prerequisites

- Bun (or your preferred package manager)
- Two EVM wallets: one for selling (receives payments), one for testing as a buyer

### 1. Clone and install

```bash
git clone <repo-url> tollpost
cd tollpost
bun install
```

### 2. Configure

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```
SELLER_ADDRESS=0xYOUR_SELLER_WALLET_ADDRESS
ARTICLE_PRICE=0.01
```

`SELLER_ADDRESS` is the wallet that receives USDC payments. You only need the public address — no private key required on the server.

### 3. Add your content

The template ships with sample blog posts that explain how the x402 integration works — read them before replacing them. Then swap in your own content:

- Replace the posts in `src/content/blog/` with your own MDX or Markdown files
- Replace pages like `src/pages/about.astro` with your own
- Update the site title and description in `src/consts.ts`

Each post needs frontmatter:

```yaml
---
title: "My Post"
description: "A short description"
pubDate: "Mar 01 2026"
---
Your content here.
```

Every post is automatically available at both `/blog/{slug}` (free HTML) and `/api/posts/{slug}` (paid JSON).

### 4. Run

```bash
bun dev
```

Your blog is at `http://localhost:4321`. The paid API is at `http://localhost:4321/api/posts/{slug}`.

## Testing the integration

### Test the 402 response (no wallet needed)

```bash
bun run test:402
```

This hits the API endpoint with no payment and prints the `402 Payment Required` response with pricing details.

### Test the full payment flow

You need a buyer wallet with testnet USDC. Get free testnet USDC from the [Circle Faucet](https://faucet.circle.com/) (select Base Sepolia). Set `BUYER_PRIVATE_KEY` in your `.env` file, then:

```bash
bun run test:pay
```

This simulates an AI agent: deposits USDC into Gateway (if needed), pays for an article, and prints the full response with before/after balances.

Example output:

```
Wallet: 0xb44e...4c33
Chain:  Base Sepolia

Gateway USDC (before): 23.645774

Paying for /api/posts/how-tollpost-works...

--- Payment ---
Amount:      0.01 USDC
Transaction: b7e6187f-34c4-4b43-a857-8894ae1eb5a3
Network:     eip155:84532
Payer:       0xb44e...4c33

--- Balance ---
Before: 23.645774 USDC
After:  23.635774 USDC

--- Article ---
Title:       How TollPost Works
...
```

## Project structure

```
src/
  content/blog/           # Your blog posts (MDX/Markdown)
  pages/
    blog/[...slug].astro  # Free static pages for humans
    api/posts/[slug].ts   # Paid JSON endpoint for agents
  lib/x402.ts             # x402 payment helper
scripts/
  test-client.ts          # Test script (acts as a buyer agent)
  withdraw.ts             # Check balance and withdraw earnings
```

The blog is built with [Astro](https://docs.astro.build). See the [Astro docs](https://docs.astro.build) for customizing pages, layouts, and components.

## How the x402 integration works

The integration is three files:

**`src/lib/x402.ts`** — Payment helper that wraps `BatchFacilitatorClient` from the SDK. Handles building 402 responses with the `PAYMENT-REQUIRED` header, and settling payments via Circle Gateway when a valid `Payment-Signature` header is received.

**`src/pages/api/posts/[slug].ts`** — Server endpoint that looks up a post from the content collection. If no payment signature is present, returns 402 with the price. If a valid signature is present, settles with Gateway and returns the post as JSON.

**`astro.config.mjs`** — Adds the Node adapter so the API route runs server-side. All other pages remain static.

The seller wallet receives USDC into its Gateway balance. To check earnings and withdraw, use the included script:

Make sure `SELLER_PRIVATE_KEY` is set in your `.env` file, then:

```bash
# Check balance and withdraw all earnings
bun run withdraw

# Withdraw a specific amount
AMOUNT=5 bun run withdraw

# Check balance only
bun run balance
```

Withdrawals are on-chain transactions that cost gas. On L2s like Base, gas is fractions of a cent, so small withdrawals are fine. On Ethereum mainnet, let earnings accumulate before withdrawing.

## License

[![Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE)
