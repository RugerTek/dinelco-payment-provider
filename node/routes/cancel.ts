import { PersistedPaymentData } from '../types/dinelco'

const PAYMENTS_BUCKET = 'payments'

export async function dinelcoCancel(ctx: any, next: () => Promise<any>) {
  const { paymentId } = ctx.vtex.route.params as { paymentId: string }

  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
  ctx.set('Cache-Control', 'no-cache')

  if (ctx.method === 'OPTIONS') {
    ctx.status = 200
    await next()
    return
  }

  try {
    const persistedData = (await ctx.clients.vbase.getJSON(
      PAYMENTS_BUCKET,
      paymentId,
      true
    )) as PersistedPaymentData | undefined

    if (!persistedData?.request) {
      ctx.status = 404
      ctx.body = { error: 'Payment not found' }
      await next()
      return
    }

    // Only mark as denied if still pending — don't override an already-approved payment
    if (persistedData.response?.status === 'undefined') {
      await ctx.clients.vbase.saveJSON(PAYMENTS_BUCKET, paymentId, {
        ...persistedData,
        response: {
          ...persistedData.response,
          status: 'denied',
          code: 'cancelled',
          message: 'Payment cancelled by user',
        },
      })
    }

    ctx.status = 200
    ctx.body = { cancelled: true }
  } catch (error) {
    ctx.status = 500
    ctx.body = { error: 'Failed to cancel payment' }
  }

  await next()
}
