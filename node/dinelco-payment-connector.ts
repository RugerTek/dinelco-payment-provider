import {
  AuthorizationRequest,
  AuthorizationResponse,
  Authorizations,
  CancellationRequest,
  CancellationResponse,
  Cancellations,
  CustomField,
  InboundRequest,
  InboundResponse,
  PaymentProvider,
  RefundRequest,
  RefundResponse,
  Refunds,
  SettlementRequest,
  SettlementResponse,
  Settlements,
} from '@vtex/payment-provider'

import { DinelcoClient } from './clients/dinelco-client'
import {
  CreateSessionRequest,
  DinelcoConfig,
  CreateSessionResponse,
  PersistedPaymentData,
} from './types/dinelco'
import { randomString } from './utils'

class DinelcoPaymentConnector extends PaymentProvider {
  private authorizationsBucket = 'payments'

  public async authorize(
    authorization: AuthorizationRequest
  ): Promise<AuthorizationResponse> {
    try {
      // Verificar si ya hay una respuesta guardada (de callbacks o consultas previas)
      const persistedData = await this.getPaymentData(authorization.paymentId)
      const persistedResponse = persistedData?.response

      if (persistedResponse != null) {
        // Si el estado aún es 'undefined', intentar actualizar consultando a Dinelco
        if (persistedResponse.status === 'undefined') {
          const updatedStatus = await this.getPaymentStatus(
            authorization.paymentId,
            authorization
          )

          if (updatedStatus && updatedStatus.status !== 'undefined') {
            return updatedStatus
          }
        }

        return persistedResponse
      }

      const dinelcoClient = this.createDinelcoClient(authorization)
      const sessionData = this.createSessionDataFromRequest(authorization)

      const sessionResponse = await dinelcoClient.createCheckoutSession(
        sessionData
      )

      const session: CreateSessionResponse = {
        sessionId: sessionResponse.sessionId,
        integrityToken: sessionResponse.integrityToken,
        expirationDate: sessionResponse.expirationDate,
      }

      // Esto indica a VTEX que debe mostrar el Payment App
      const response: AuthorizationResponse = {
        status: 'approved',
        paymentId: authorization.paymentId,
        acquirer: 'Dinelco',
        code: 'undefined',
        message: 'Payment pending - opening Dinelco Payment App',
        tid: sessionResponse.sessionId.toString(),
        authorizationId: randomString(),
        nsu: randomString(),
        delayToCancel: 300000,
        delayToAutoSettle: 0,
        // Payment App Data - VTEX usará esto para mostrar el Payment App
        paymentAppData: {
          appName: 'bepsapartnerpy.dinelco-payment-app', // vendor.appName según manifest
          payload: JSON.stringify({
            token: sessionResponse.integrityToken,
            paymentId: authorization.paymentId,
            sessionId: sessionResponse.sessionId,
            environment: this.getDinelcoConfig(authorization).environment,
            validateUrl:
              this.getDinelcoConfig(authorization).environment === 'sandbox'
                ? 'https://dev-sgwf-01.bepsa.com.py/d/api/checkout-session/validate'
                : 'https://checkout.dinelco.com.py/d/api/checkout-session/validate',
            amount: sessionData.amount,
            currency: sessionData.currency,
          }),
        },
      }

      await this.persistPayment(authorization, response, session)

      return response
    } catch (error) {
      return Authorizations.deny(authorization, {
        acquirer: 'Dinelco',
        code: 'generic-error',
        message:
          error instanceof Error ? error.message : 'Unknown error occurred',
        tid: authorization.transactionId,
      })
    }
  }

  public async cancel(
    cancellation: CancellationRequest
  ): Promise<CancellationResponse> {
    return Cancellations.manual(cancellation)
  }

  public async refund(refund: RefundRequest): Promise<RefundResponse> {
    // Dinelco no soporta reembolsos programáticos
    // Los reembolsos deben hacerse manualmente desde el panel de Dinelco
    return Refunds.manual(refund)
  }

  public async settle(
    settlement: SettlementRequest
  ): Promise<SettlementResponse> {
    // Dinelco captura automáticamente cuando el pago es aprobado
    // No requiere un paso de settlement separado
    return Settlements.approve(settlement, {
      settleId: `se-${settlement.transactionId}`,
    })
  }

  public async inbound?(inbound: InboundRequest): Promise<InboundResponse> {
    return {
      code: '0000',
      paymentId: inbound.paymentId,
      message:
        'Esta funcionalidad solo esta disponible desde el portal de Dinelco.',
    } as InboundResponse
  }

  private createDinelcoClient(request?: any): DinelcoClient {
    const config = this.getDinelcoConfig(request)

    return new DinelcoClient(this.context.vtex, { config })
  }

  private getDinelcoConfig(request?: any): DinelcoConfig {
    // En VTEX IO, los custom fields vienen en el request del payment provider
    // Metodo 1: Custom Fields (producción) - vienen en request.customFields
    const customFields = request?.customFields || {}

    // Metodo 2: Variables de entorno (desarrollo local con vtex link)
    const apiKey =
      request?.merchantSettings?.find((s: CustomField) => s.name === 'API Key')
        ?.value ??
      process.env.DINELCO_API_KEY ??
      'di_sk_fallback' // Fallback para testing

    const environment =
      // eslint-disable-next-line dot-notation
      customFields['Environment'] || // Desde admin VTEX
      process.env.DINELCO_ENVIRONMENT || // Desarrollo local
      'sandbox'

    // const callbackUrl =
    //   customFields['Callback URL'] || process.env.DINELCO_CALLBACK_URL // Desarrollo local

    return {
      apiKey,
      environment: environment as 'sandbox' | 'production',
    }
  }

  private async persistPayment(
    req: AuthorizationRequest,
    resp: AuthorizationResponse,
    session?: CreateSessionResponse
  ) {
    await this.persistPaymentData(req.paymentId, {
      response: resp,
      session,
    })
  }

  private createSessionDataFromRequest(
    request: AuthorizationRequest
  ): CreateSessionRequest {
    // Handling different currencies
    // PYG does not use decimals, VTEX sends the value as is.
    // For currencies with 2 decimals (like USD), VTEX sends the value multiplied by 100.
    // Dinelco expects the amount in the base unit (no decimals for PYG, with decimals for USD).
    const isNoDecimalCurrency = request.currency === 'PYG'
    const amount = isNoDecimalCurrency
      ? Math.round(request.value)
      : parseFloat((request.value / 100).toFixed(2))

    return {
      clientReferenceId: request.paymentId,
      amount,
      currency: request.currency || 'PYG',
      targetOrigin: 'https://checkout.vtex.com',
      // Callback URL: Dinelco enviará notificaciones aquí (opcional)
      // Por ahora lo dejamos undefined y usaremos polling/consultas para verificar el estado
      callbackUrl: request.callbackUrl, // Solo si el merchant lo configura
      returnUrl: request.returnUrl,
      lineItems: [
        {
          name: 'Compra VTEX',
          description: `Pago para orden ${request.orderId ||
            request.paymentId}`,
          price: amount,
          quantity: 1,
        },
      ],
      metadata: {
        orderId: request.orderId || '',
        paymentId: request.paymentId,
        vtexAccount: this.context.vtex.account,
      },
      customer: {
        customerId: request.paymentId,
        name: request.miniCart?.buyer?.firstName ?? '',
        lastname: request.miniCart?.buyer?.lastName ?? '',
        email: request.miniCart?.buyer?.email ?? '',
        phone: request.miniCart?.buyer?.phone ?? '',
      },
    }
  }

  /**
   * Consultar el estado actual de un pago
   * Primero intenta obtener el estado guardado en VBase.
   * Si no hay un estado final, consulta directamente a Dinelco usando el sessionId.
   */
  private async getPaymentStatus(
    paymentId: string,
    request?: any
  ): Promise<AuthorizationResponse | null> {
    try {
      // 1. Intentar obtener de datos persistidos
      const persistedData = await this.getPaymentData(paymentId)

      if (
        persistedData?.response &&
        persistedData.response.status !== 'undefined'
      ) {
        return persistedData.response
      }

      // 2. Si no hay respuesta definitiva, consultar a Dinelco
      if (!persistedData?.session?.sessionId) {
        return null
      }

      const { sessionId } = persistedData.session
      const dinelcoClient = this.createDinelcoClient(request)
      const paymentStatus = await dinelcoClient.queryPaymentStatus(sessionId)

      // Convertir el estado de Dinelco a VTEX
      let vtexStatus: 'approved' | 'denied' | 'undefined' = 'undefined'

      if (paymentStatus.paymentStatus === 'APPROVED') {
        vtexStatus = 'approved'
      } else if (paymentStatus.paymentStatus === 'REJECTED') {
        vtexStatus = 'denied'
      }

      // Ensure we have a valid ID for approved payments
      // Fallback to sessionId if authorizationCode is missing
      const authCode =
        paymentStatus.authorizationCode?.toString() ?? sessionId.toString()

      const response: AuthorizationResponse = {
        status: vtexStatus,
        paymentId,
        acquirer: 'Dinelco',
        code: paymentStatus.paymentStatus ?? 'undefined',
        message: paymentStatus.paymentMessage ?? 'Payment status checked',
        tid: sessionId.toString(), // Mantener sessionId como tid por consistencia hasta que finalice
        authorizationId: authCode,
        nsu: authCode,
      }

      // Guardar de forma unificada preservando la sesión
      await this.persistPaymentData(paymentId, {
        response,
        session: persistedData.session,
      })

      return response
    } catch (error) {
      return null
    }
  }

  private async persistPaymentData(
    paymentId: string,
    data: PersistedPaymentData
  ) {
    return this.context.clients.vbase.saveJSON(
      this.authorizationsBucket,
      paymentId,
      data
    )
  }

  private async getPaymentData(paymentId: string) {
    return this.context.clients.vbase.getJSON<PersistedPaymentData | undefined>(
      this.authorizationsBucket,
      paymentId,
      true
    )
  }
}

export default DinelcoPaymentConnector
