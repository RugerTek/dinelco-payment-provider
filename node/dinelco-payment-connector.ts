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
  DinelcoConfig,
  PersistedPaymentData,
} from './types/dinelco'
import { randomString } from './utils'

class DinelcoPaymentConnector extends PaymentProvider {
  private authorizationsBucket = 'payments'

  public async authorize(
    authorization: AuthorizationRequest
  ): Promise<AuthorizationResponse> {
    try {
      const persistedData = await this.getPaymentData(authorization.paymentId)

      if (persistedData?.response != null) {
        if (persistedData.response.status !== 'undefined') {
          return persistedData.response
        }

        const updatedStatus = await this.getPaymentStatus(
          authorization.paymentId,
          authorization
        )

        if (updatedStatus && updatedStatus.status !== 'undefined') {
          return updatedStatus
        }

        return persistedData.response
      }

      const config = this.getDinelcoConfig(authorization)
      const { workspace, account } = this.context.vtex
      const host =
        workspace === 'master'
          ? `${account}.myvtex.com`
          : `${workspace}--${account}.myvtex.com`

      const isNoDecimalCurrency = authorization.currency === 'PYG'
      const amount = isNoDecimalCurrency
        ? Math.round(authorization.value)
        : parseFloat((authorization.value / 100).toFixed(2))

      const response: AuthorizationResponse = {
        status: 'undefined',
        paymentId: authorization.paymentId,
        acquirer: 'Dinelco',
        code: 'undefined',
        message: 'Payment pending - opening Dinelco Payment App',
        tid: authorization.paymentId,
        authorizationId: randomString(),
        nsu: randomString(),
        delayToCancel: 300000,
        paymentAppData: {
          appName: 'bepsapartnerpy.dinelco-payment-app',
          payload: JSON.stringify({
            paymentId: authorization.paymentId,
            sessionEndpoint: `https://${host}/_v/dinelco/session/${authorization.paymentId}`,
            environment: config.environment,
            amount,
            currency: authorization.currency || 'PYG',
          }),
        },
      }

      await this.persistPaymentData(authorization.paymentId, {
        response,
        request: authorization,
      })

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
      request?.merchantSettings?.find((s: CustomField) => s.name === 'Dinelco Secret')
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
