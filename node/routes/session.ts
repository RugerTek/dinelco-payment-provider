import { IOContext } from '@vtex/api'
import { CustomField } from '@vtex/payment-provider'

import { DinelcoClient } from '../clients/dinelco-client'
import { DinelcoConfig, PersistedPaymentData } from '../types/dinelco'

const PAYMENTS_BUCKET = 'payments'

// Margen para que el token no venza entre la respuesta y el submit del formulario
const TOKEN_EXPIRY_MARGIN_MS = 60 * 1000

function getDinelcoConfig(request: any): DinelcoConfig {
  const apiKey =
    request?.merchantSettings?.find((s: CustomField) => s.name === 'Dinelco Secret')?.value ??
    process.env.DINELCO_API_KEY ??
    'di_sk_fallback'

  const environment =
    request?.merchantSettings?.find((s: CustomField) => s.name === 'Environment')?.value ??
    process.env.DINELCO_ENVIRONMENT ??
    'sandbox'

  return {
    apiKey,
    environment: environment as 'sandbox' | 'production',
  }
}

function getValidateUrl(environment: string): string {
  return environment === 'sandbox'
    ? 'https://test-checkout.dinelco.com.py/d/api/checkout-session/validate'
    : 'https://checkout.dinelco.com.py/d/api/checkout-session/validate'
}

function toHttpsOrigin(value?: string): string | undefined {
  if (!value) return undefined

  try {
    const url = new URL(value)

    return url.protocol === 'https:' ? url.origin : undefined
  } catch {
    return undefined
  }
}

// La tienda puede usar un dominio propio: se declara también el origen real del checkout
function getTargetOrigin(ctx: any): string {
  const { account, workspace } = ctx.vtex
  const myvtexOrigin =
    workspace === 'master'
      ? `https://${account}.myvtex.com`
      : `https://${workspace}--${account}.myvtex.com`

  const checkoutOrigin = toHttpsOrigin(ctx.get('origin')) ?? toHttpsOrigin(ctx.get('referer'))
  const origins = new Set([myvtexOrigin])

  if (checkoutOrigin) origins.add(checkoutOrigin)

  return Array.from(origins).join(',')
}

function isTokenExpired(expirationDate?: string): boolean {
  if (!expirationDate) return false

  return Date.parse(expirationDate) - TOKEN_EXPIRY_MARGIN_MS <= Date.now()
}

async function createSession(ctx: any, persistedData: PersistedPaymentData, paymentId: string) {
  const request = persistedData.request as any
  const config = getDinelcoConfig(request)
  const dinelcoClient = new DinelcoClient(ctx.vtex as IOContext, { config })

  const isNoDecimalCurrency = request.currency === 'PYG'
  const amount = isNoDecimalCurrency
    ? Math.round(request.value)
    : parseFloat((request.value / 100).toFixed(2))

  // Dinelco pide una referencia única por sesión: las renovaciones llevan sufijo
  const clientReferenceId = persistedData.session
    ? `${request.paymentId}-${Date.now()}`
    : request.paymentId

  const sessionResponse = await dinelcoClient.createCheckoutSession({
    clientReferenceId,
    amount,
    currency: request.currency || 'PYG',
    targetOrigin: getTargetOrigin(ctx),
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

  return {
    token: sessionResponse.integrityToken,
    sessionId: sessionResponse.sessionId,
    validateUrl: getValidateUrl(config.environment),
  }
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

      let statusChecked = false
      let paymentStatus: string | undefined
      let authorizationCode: string | undefined
      let operationNumber: string | undefined

      try {
        const statusResponse = await dinelcoClient.queryPaymentStatus(
          persistedData.session.sessionId
        )

        statusChecked = true
        paymentStatus = statusResponse.paymentStatus
        authorizationCode = statusResponse.authorizationCode?.toString()
        operationNumber = statusResponse.operationNumber?.toString()
      } catch {
        // If status check fails, return without paymentStatus
      }

      if (paymentStatus === 'APPROVED' || paymentStatus === 'REJECTED') {
        const finalStatus = paymentStatus === 'APPROVED' ? 'approved' : 'denied'
        const authId = authorizationCode ?? persistedData.response?.authorizationId ?? ''

        await ctx.clients.vbase.saveJSON(PAYMENTS_BUCKET, paymentId, {
          ...persistedData,
          operationNumber,
          response: {
            ...persistedData.response,
            status: finalStatus,
            authorizationId: authId,
            code: paymentStatus,
            message: `Payment ${finalStatus} by Dinelco`,
          },
        })
      }

      // Solo se renueva si Dinelco confirma que no hubo ningún intento de pago
      const shouldRenew =
        statusChecked && !paymentStatus && isTokenExpired(persistedData.session.expirationDate)

      if (!shouldRenew) {
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
    }

    ctx.status = 200
    ctx.body = await createSession(ctx, persistedData, paymentId)
  } catch (error) {
    ctx.status = 500
    ctx.body = { error: (error as any).message || 'Failed to create Dinelco session' }
  }

  await next()
}
