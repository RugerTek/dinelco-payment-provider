import { CallbackPayload } from '../types/dinelco'

const PAYMENTS_BUCKET = 'payments'

export async function dinelcoCallback(ctx: any, next: () => Promise<any>) {
  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('Cache-Control', 'no-cache')

  try {
    const body = ctx.request.body as CallbackPayload

    // Dinelco automatically prefixes clientReferenceId with "embed-"
    const paymentId = (body.clientReferenceId ?? '').replace(/^embed-/, '')

    if (!paymentId || !body.payment?.status) {
      ctx.status = 400
      ctx.body = { error: 'Invalid callback payload' }
      await next()
      return
    }

    const persistedData = await ctx.clients.vbase.getJSON(
      PAYMENTS_BUCKET,
      paymentId,
      true
    )

    if (!persistedData?.request) {
      ctx.status = 404
      ctx.body = { error: 'Payment not found' }
      await next()
      return
    }

    const { status, authorizationCode, operationNumber } = body.payment

    // Only persist final states — ignore PROCESSING
    if (status === 'APPROVED' || status === 'REJECTED') {
      const finalStatus = status === 'APPROVED' ? 'approved' : 'denied'
      const authId =
        authorizationCode?.toString() ??
        operationNumber?.toString() ??
        persistedData.response?.authorizationId ??
        ''

      await ctx.clients.vbase.saveJSON(PAYMENTS_BUCKET, paymentId, {
        ...persistedData,
        operationNumber: operationNumber?.toString(),
        response: {
          ...persistedData.response,
          status: finalStatus,
          authorizationId: authId,
          nsu: authId,
          code: status,
          message: body.message || `Payment ${finalStatus} by Dinelco`,
        },
      })

    }

    ctx.status = 200
    ctx.body = { received: true }
  } catch (error) {
    ctx.status = 500
    ctx.body = { error: 'Failed to process callback' }
  }

  await next()
}
