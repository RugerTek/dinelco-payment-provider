import { IOContext } from '@vtex/api'
import { CustomField } from '@vtex/payment-provider'

import { DinelcoClient } from '../clients/dinelco-client'
import { DinelcoConfig, PersistedPaymentData } from '../types/dinelco'

const PAYMENTS_BUCKET = 'payments'

function getDinelcoConfig(request: any): DinelcoConfig {
  const apiKey =
    request?.merchantSettings?.find((s: CustomField) => s.name === 'Dinelco Secret')?.value ??
    process.env.DINELCO_API_KEY ??
    'di_sk_fallback'

  const environment =
    request?.customFields?.['Environment'] ??
    process.env.DINELCO_ENVIRONMENT ??
    'sandbox'

  return {
    apiKey,
    environment: environment as 'sandbox' | 'production',
  }
}

function getValidateUrl(environment: string): string {
  return environment === 'sandbox'
    ? 'https://dev-sgwf-01.bepsa.com.py/d/api/checkout-session/validate'
    : 'https://checkout.dinelco.com.py/d/api/checkout-session/validate'
}

export async function dinelcoCreateSession(ctx: any, next: () => Promise<any>) {
  const { paymentId } = ctx.vtex.route.params as { paymentId: string }

  ctx.set('Access-Control-Allow-Origin', '*')
  ctx.set('Access-Control-Allow-Methods', 'GET, OPTIONS')
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

    // Session already created — check current payment status from Dinelco
    if (persistedData.session?.sessionId) {
      const config = getDinelcoConfig(persistedData.request)
      const dinelcoClient = new DinelcoClient(ctx.vtex as IOContext, { config })

      let paymentStatus: string | undefined
      let authorizationCode: string | undefined

      try {
        const statusResponse = await dinelcoClient.queryPaymentStatus(
          persistedData.session.sessionId
        )

        paymentStatus = statusResponse.paymentStatus
        authorizationCode = statusResponse.authorizationCode?.toString()
      } catch {
        // If status check fails, return without paymentStatus
      }

      // If APPROVED or REJECTED, persist the final response so authorize()
      // returns it directly on the next VTEX retry without calling Dinelco again
      if (paymentStatus === 'APPROVED' || paymentStatus === 'REJECTED') {
        const finalStatus = paymentStatus === 'APPROVED' ? 'approved' : 'denied'
        const authId = authorizationCode ?? persistedData.response?.authorizationId ?? ''

        await ctx.clients.vbase.saveJSON(PAYMENTS_BUCKET, paymentId, {
          ...persistedData,
          response: {
            ...persistedData.response,
            status: finalStatus,
            authorizationId: authId,
            code: paymentStatus,
            message: `Payment ${finalStatus} by Dinelco`,
          },
        })
      }

      ctx.status = 200
      ctx.body = {
        token: persistedData.session.integrityToken,
        sessionId: persistedData.session.sessionId,
        validateUrl: getValidateUrl(config.environment),
        paymentStatus,
      }
      await next()
      return
    }

    // Create session now
    const { request } = persistedData
    const config = getDinelcoConfig(request)
    const dinelcoClient = new DinelcoClient(ctx.vtex as IOContext, { config })
    const { account, workspace } = ctx.vtex
    const storeHost =
      workspace === 'master'
        ? `${account}.myvtex.com`
        : `${workspace}--${account}.myvtex.com`

    const isNoDecimalCurrency = request.currency === 'PYG'
    const amount = isNoDecimalCurrency
      ? Math.round(request.value)
      : parseFloat((request.value / 100).toFixed(2))

    const sessionResponse = await dinelcoClient.createCheckoutSession({
      clientReferenceId: request.paymentId,
      amount,
      currency: request.currency || 'PYG',
      targetOrigin: `https://${storeHost}`,
      callbackUrl: request.callbackUrl,
      returnUrl: request.returnUrl,
      lineItems: [
        {
          name: 'Compra VTEX',
          description: `Pago para orden ${request.orderId || request.paymentId}`,
          price: amount,
          quantity: 1,
        },
      ],
      metadata: {
        orderId: request.orderId || '',
        paymentId: request.paymentId,
      },
      customer: {
        customerId: request.paymentId,
        name: request.miniCart?.buyer?.firstName ?? '',
        lastname: request.miniCart?.buyer?.lastName ?? '',
        email: request.miniCart?.buyer?.email ?? '',
        phone: request.miniCart?.buyer?.phone ?? '',
      },
    })

    await ctx.clients.vbase.saveJSON(PAYMENTS_BUCKET, paymentId, {
      ...persistedData,
      session: {
        sessionId: sessionResponse.sessionId,
        integrityToken: sessionResponse.integrityToken,
        expirationDate: sessionResponse.expirationDate,
      },
    })

    ctx.status = 200
    ctx.body = {
      token: sessionResponse.integrityToken,
      sessionId: sessionResponse.sessionId,
      validateUrl: getValidateUrl(config.environment),
    }
  } catch (error) {
    ctx.status = 500
    ctx.body = { error: (error as any).message || 'Failed to create Dinelco session' }
  }

  await next()
}
