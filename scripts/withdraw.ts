/**
 * Manage seller earnings from Circle Gateway.
 *
 * Usage:
 *   bun run balance                                   # show balances across all chains
 *   bun run withdraw                                  # withdraw all to default chain
 *   DEST_CHAIN=baseSepolia bun run withdraw           # withdraw all to Base Sepolia
 *   AMOUNT=5 DEST_CHAIN=baseSepolia bun run withdraw  # withdraw 5 USDC to Base Sepolia
 *
 * Environment variables:
 *   SELLER_PRIVATE_KEY  - Seller wallet private key (0x-prefixed)
 *   DEST_CHAIN          - Destination chain for withdrawal (default: baseSepolia)
 *   AMOUNT              - Amount to withdraw per chain in USDC (default: all available)
 *   NETWORK             - "testnet" (default) or "mainnet"
 */

async function loadGateway() {
  const privateKey = process.env.SELLER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("Error: SELLER_PRIVATE_KEY env var is required.");
    process.exit(1);
  }

  const { GatewayClient, GATEWAY_DOMAINS } =
    await import("@circle-fin/x402-batching/client");

  return {
    GatewayClient,
    GATEWAY_DOMAINS,
    privateKey: privateKey as `0x${string}`,
  };
}

async function getAllBalances() {
  const { GatewayClient, GATEWAY_DOMAINS, privateKey } = await loadGateway();
  const { CHAIN_CONFIGS } = await import("@circle-fin/x402-batching/client");
  type SupportedChainName = keyof typeof GATEWAY_DOMAINS;
  const isTestnet = (process.env.NETWORK || "testnet") === "testnet";
  const chains = (Object.keys(GATEWAY_DOMAINS) as SupportedChainName[]).filter(
    (chain) => !!CHAIN_CONFIGS[chain].chain.testnet === isTestnet,
  );

  const results: {
    chain: SupportedChainName;
    available: bigint;
    formatted: string;
  }[] = [];

  for (const chain of chains) {
    try {
      const client = new GatewayClient({ chain, privateKey });
      const balances = await client.getBalances();
      if (balances.gateway.available > 0n) {
        results.push({
          chain,
          available: balances.gateway.available,
          formatted: balances.gateway.formattedAvailable,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`  [warn] ${chain}: ${message}`);
    }
  }

  return results;
}

async function balance() {
  const { GatewayClient, privateKey } = await loadGateway();
  const client = new GatewayClient({ chain: "baseSepolia", privateKey });

  console.log(`\nWallet: ${client.address}\n`);
  console.log("Scanning Gateway balances across all chains...\n");

  const balances = await getAllBalances();

  if (balances.length === 0) {
    console.log("No Gateway balance on any chain.");
    return;
  }

  let total = 0n;
  for (const balance of balances) {
    console.log(`  ${balance.chain}: ${balance.formatted} USDC`);
    total += balance.available;
  }

  const formattedTotal = (Number(total) / 1_000_000).toFixed(6);
  console.log(`\n  Total: ${formattedTotal} USDC`);
}

async function withdraw() {
  const { GatewayClient, GATEWAY_DOMAINS, privateKey } = await loadGateway();
  type SupportedChainName = keyof typeof GATEWAY_DOMAINS;

  const destChain = (process.env.DEST_CHAIN ||
    "baseSepolia") as SupportedChainName;

  if (!(destChain in GATEWAY_DOMAINS)) {
    console.error(
      `Error: unsupported chain '${destChain}'. Valid: ${Object.keys(GATEWAY_DOMAINS).join(", ")}`,
    );
    process.exit(1);
  }

  const client = new GatewayClient({ chain: destChain, privateKey });
  console.log(`\nWallet:     ${client.address}`);
  console.log(`Withdraw to: ${client.chainName}\n`);

  console.log("Scanning Gateway balances across all chains...\n");
  const balances = await getAllBalances();

  if (balances.length === 0) {
    console.log("No Gateway balance to withdraw.");
    return;
  }

  for (const balance of balances) {
    console.log(`  ${balance.chain}: ${balance.formatted} USDC`);
  }

  console.log("");

  for (const balance of balances) {
    const amount = process.env.AMOUNT || balance.formatted;
    const sourceClient = new GatewayClient({
      chain: balance.chain,
      privateKey,
    });

    console.log(
      `Withdrawing ${amount} USDC from ${balance.chain} to ${destChain}...`,
    );
    const result = await sourceClient.withdraw(amount, { chain: destChain });

    console.log(
      `  Withdrew ${result.formattedAmount} USDC (tx: ${result.mintTxHash})`,
    );
    console.log(`  ${result.sourceChain} -> ${result.destinationChain}\n`);
  }

  const after = await client.getBalances();
  console.log(`Wallet balance on ${destChain}: ${after.wallet.formatted} USDC`);
}

const command = process.argv[2];

if (command === "balance") {
  balance().catch(console.error);
} else {
  withdraw().catch(console.error);
}
