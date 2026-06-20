import * as https from 'https'
import { URL } from 'url'

import { PersistedPaymentData } from '../types/dinelco'

const PAYMENTS_BUCKET = 'payments'

function postToUrl(urlString: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(urlString)
      const req = https.request(
        {
          hostname: parsed.hostname,
          path: parsed.pathname + parsed.search,
          method: 'POST',
          headers: { 'Content-Length': '0' },
        },
        () => resolve()
      )
      req.on('error', () => resolve())
      req.end()
    } catch {
      resolve()
    }
  })
}

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

    // Only act if still pending — don't override an already-approved payment
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

      // Trigger VTEX to immediately retry authorize() so it reads the denied status
      // from VBase before transactionValidation.vtex fires in the payment app
      const retryUrl = persistedData.request.callbackUrl
      if (retryUrl) {
        await postToUrl(retryUrl)
      }
    }

    ctx.status = 200
    ctx.body = { cancelled: true }
  } catch (error) {
    ctx.status = 500
    ctx.body = { error: 'Failed to cancel payment' }
  }

  await next()
}
