export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { paymentRequiredResponse, settlePayment, paymentResponseHeader } from '../../../lib/x402';

const SELLER_ADDRESS = import.meta.env.SELLER_ADDRESS;
const ARTICLE_PRICE = import.meta.env.ARTICLE_PRICE || '0.01';

export const GET: APIRoute = async ({ params, request }) => {
  const posts = await getCollection('blog');
  const post = posts.find((post) => post.id === params.slug);

  if (!post) {
    return new Response(JSON.stringify({ error: 'Post not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check for payment signature
  const signature = request.headers.get('payment-signature');

  if (!signature) {
    const resourceUrl = new URL(request.url).pathname;
    return paymentRequiredResponse(SELLER_ADDRESS, ARTICLE_PRICE, resourceUrl);
  }

  // Settle the payment
  const result = await settlePayment(signature, SELLER_ADDRESS, ARTICLE_PRICE);

  if (!result.success) {
    return result.response;
  }

  return new Response(
    JSON.stringify({
      id: post.id,
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate.toISOString(),
      updatedDate: post.data.updatedDate?.toISOString() ?? null,
      content: post.body,
      payment: {
        payer: result.payer,
        transaction: result.transaction,
        network: result.network,
      },
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'PAYMENT-RESPONSE': paymentResponseHeader(result),
      },
    },
  );
};
