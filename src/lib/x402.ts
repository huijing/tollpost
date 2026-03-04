import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";

const facilitator = new BatchFacilitatorClient();

let cachedKinds:
  | Awaited<ReturnType<typeof facilitator.getSupported>>["kinds"]
  | null = null;

/**
 * Build a 402 Payment Required response for an unpaid request.
 * Wraps facilitator.getSupported() to advertise accepted networks and prices.
 */
export async function paymentRequiredResponse(
  sellerAddress: string,
  price: string,
  resourceUrl: string,
): Promise<Response> {
  const kinds = await getSupportedKinds();

  const accepts = kinds
    .filter((kind) => kind.extra?.verifyingContract && getUsdcAddress(kind))
    .map((kind) => ({
      scheme: "exact",
      network: kind.network,
      asset: getUsdcAddress(kind),
      amount: toUsdcAmount(price),
      maxTimeoutSeconds: 345600,
      payTo: sellerAddress,
      extra: {
        name: "GatewayWalletBatched",
        version: "1",
        verifyingContract: kind.extra!.verifyingContract,
      },
    }));

  const paymentRequired = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description: "Paid blog post",
      mimeType: "application/json",
    },
    accepts,
  };

  return new Response(JSON.stringify({}), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "PAYMENT-REQUIRED": Buffer.from(JSON.stringify(paymentRequired)).toString(
        "base64",
      ),
    },
  });
}

/**
 * Verify and settle a payment signature. Returns payment info on success,
 * or an error Response on failure.
 * Wraps facilitator.settle() to process the agent's signed payment.
 */
export async function settlePayment(
  signature: string,
  sellerAddress: string,
  price: string,
): Promise<
  | { success: true; payer: string; transaction: string; network: string }
  | { success: false; response: Response }
> {
  const paymentPayload = JSON.parse(
    Buffer.from(signature, "base64").toString(),
  );

  const acceptedNetwork = paymentPayload.accepted?.network;
  if (!acceptedNetwork) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({ error: "Missing accepted requirements in payment" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const requirements = await createPaymentRequirements(
    sellerAddress,
    price,
    acceptedNetwork,
  );
  if (!requirements) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({ error: `Network ${acceptedNetwork} not accepted` }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  const settlement = await facilitator.settle(paymentPayload, requirements);
  if (!settlement.success) {
    return {
      success: false,
      response: new Response(
        JSON.stringify({
          error: "Settlement failed",
          reason: settlement.errorReason,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      ),
    };
  }

  return {
    success: true,
    payer: settlement.payer ?? "",
    transaction: settlement.transaction,
    network: requirements.network,
  };
}

/**
 * Reconstruct payment requirements for a specific network (server-side).
 * Mirrors what createGatewayMiddleware does internally.
 */
async function createPaymentRequirements(
  sellerAddress: string,
  price: string,
  network: string,
) {
  const kinds = await getSupportedKinds();
  const kind = kinds.find((kind) => kind.network === network);
  if (!kind?.extra?.verifyingContract) return null;

  const usdcAddress = getUsdcAddress(kind);
  if (!usdcAddress) return null;

  return {
    scheme: "exact",
    network: kind.network,
    asset: usdcAddress,
    amount: toUsdcAmount(price),
    payTo: sellerAddress,
    maxTimeoutSeconds: 345600,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: kind.extra.verifyingContract,
    },
  };
}

/**
 * Build the PAYMENT-RESPONSE header value for a successful payment.
 */
export function paymentResponseHeader(payment: {
  transaction: string;
  network: string;
  payer: string;
}): string {
  return Buffer.from(
    JSON.stringify({
      success: true,
      transaction: payment.transaction,
      network: payment.network,
      payer: payment.payer,
    }),
  ).toString("base64");
}

// --- Utilities ---
/** Lazy-cached list of Gateway-supported networks. Fetched once, reused on every request. */
async function getSupportedKinds() {
  if (!cachedKinds) {
    const supported = await facilitator.getSupported();
    cachedKinds = supported.kinds;
  }
  return cachedKinds;
}

/**
 * Extract USDC address from a supported kind's assets array.
 */
function getUsdcAddress(kind: any): string | null {
  const assets = kind.extra?.assets;
  if (!assets || assets.length === 0) return null;
  const usdc = assets.find((asset: any) => asset.symbol === "USDC");
  return usdc?.address ?? null;
}

/**
 * Convert a dollar amount (e.g. "0.01") to USDC atomic units (6 decimals).
 */
function toUsdcAmount(dollars: string): string {
  const [whole, fraction = ""] = dollars.split(".");
  const paddedFraction = fraction.padEnd(6, "0");
  return (BigInt(whole) * 1_000_000n + BigInt(paddedFraction)).toString();
}
