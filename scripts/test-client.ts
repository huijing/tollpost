/**
 * Test client for TollPost x402 integration.
 *
 * Usage:
 *   1. Start the dev server: bun dev
 *   2. Run this script:
 *      - Test 402 response:  bun run test:402 [slug]
 *      - Full payment flow:  bun run test:pay [slug]
 *
 * Environment variables (for --pay):
 *   BUYER_PRIVATE_KEY  - EVM private key (0x-prefixed)
 *   CHAIN              - Chain name (default: arcTestnet)
 *
 * Get testnet USDC from https://faucet.circle.com/
 */

const BASE_URL = "http://localhost:4321";
const DEFAULT_SLUG = "what-is-tollpost";

interface PaymentOption {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

interface PaymentRequired {
  x402Version: number;
  resource: { url: string; description: string; mimeType: string };
  accepts: PaymentOption[];
}

interface ArticleResponse {
  id: string;
  title: string;
  description: string;
  pubDate: string;
  updatedDate: string | null;
  content: string;
  payment: {
    payer: string;
    transaction: string;
    network: string;
  };
}

async function test402() {
  const slug = getSlug();
  const url = `${BASE_URL}/api/posts/${slug}`;

  console.log(`\nTesting 402 Payment Required flow`);
  console.log(`GET ${url} (no payment header)\n`);

  const res = await fetch(url);

  if (res.status !== 402) {
    console.error(`Expected 402, got ${res.status}.`);
    if (res.status === 404) {
      console.error(
        `Post "${slug}" not found. Check that the slug matches a file in src/content/blog/.`,
      );
    }
    process.exit(1);
  }

  console.log(`Status: ${res.status} Payment Required`);

  const paymentHeader = res.headers.get("payment-required");
  if (paymentHeader) {
    const decoded: PaymentRequired = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString(),
    );
    const networks =
      decoded.accepts.map((option) => option.network).join(", ") || "unknown";
    const price = decoded.accepts[0]?.amount
      ? `${(parseInt(decoded.accepts[0].amount) / 1_000_000).toFixed(2)} USDC`
      : "unknown";
    console.log(`Price:    ${price}`);
    console.log(`Networks: ${networks}`);
    console.log(`PayTo:    ${decoded.accepts[0]?.payTo || "unknown"}`);
    console.log(`\nFull PAYMENT-REQUIRED header:`);
    console.log(JSON.stringify(decoded, null, 2));
  }

  console.log("\n402 response working correctly.\n");
}

async function testPayment() {
  const slug = getSlug();
  const url = `${BASE_URL}/api/posts/${slug}`;

  const privateKey = process.env.BUYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error(
      "Error: BUYER_PRIVATE_KEY env var is required for --pay mode.",
    );
    process.exit(1);
  }

  const chain = process.env.CHAIN || "arcTestnet";

  const { GatewayClient, GATEWAY_DOMAINS } =
    await import("@circle-fin/x402-batching/client");
  type SupportedChainName = keyof typeof GATEWAY_DOMAINS;

  if (!(chain in GATEWAY_DOMAINS)) {
    console.error(
      `Error: unsupported chain '${chain}'. Valid: ${Object.keys(GATEWAY_DOMAINS).join(", ")}`,
    );
    process.exit(1);
  }

  const client = new GatewayClient({
    chain: chain as SupportedChainName,
    privateKey: privateKey as `0x${string}`,
  });

  console.log(`\nTesting full payment flow`);
  console.log(`Wallet: ${client.address}`);
  console.log(`Chain:  ${client.chainName}\n`);

  const before = await client.getBalances();
  console.log(`Gateway USDC (before): ${before.gateway.formattedAvailable}\n`);

  if (before.gateway.available === 0n) {
    console.log("No Gateway balance. Depositing 1 USDC...");
    const deposit = await client.deposit("1");
    console.log(
      `Deposited ${deposit.formattedAmount} USDC (tx: ${deposit.depositTxHash})\n`,
    );
  }

  console.log(`Paying for ${url}...`);

  const { data, formattedAmount, transaction } =
    await client.pay<ArticleResponse>(url);

  const after = await client.getBalances();

  console.log("\n--- Payment ---");
  console.log(`Amount:      ${formattedAmount} USDC`);
  console.log(`Transaction: ${transaction}`);
  console.log(`Network:     ${data.payment.network}`);
  console.log(`Payer:       ${data.payment.payer}`);

  console.log("\n--- Balance ---");
  console.log(`Before: ${before.gateway.formattedAvailable} USDC`);
  console.log(`After:  ${after.gateway.formattedAvailable} USDC`);

  console.log("\n--- Article (JSON) ---");
  console.log(
    JSON.stringify(
      { ...data, content: data.content.slice(0, 400) + "..." },
      null,
      2,
    ),
  );
}

// --- Utilities ---
function getSlug(): string {
  const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  return args[0] || DEFAULT_SLUG;
}

// --- Entry point ---
const args = process.argv.slice(2);
if (args.includes("--pay")) {
  testPayment().catch(console.error);
} else {
  test402().catch(console.error);
}
