import { ExternalClient, InstanceOptions, IOContext } from '@vtex/api'

import {
  CreateSessionRequest,
  CreateSessionResponse,
  DinelcoConfig,
  DinelcoError,
} from '../types/dinelco'

const DINELCO_URLS = {
  sandbox: 'https://dev-sgwf-01.bepsa.com.py',
  production: 'https://checkout.dinelco.com.py',
}

export class DinelcoClient extends ExternalClient {
  constructor(
    context: IOContext,
    options: InstanceOptions & { config: DinelcoConfig }
  ) {
    const env = (options.config.environment ?? 'sandbox') as
      | 'production'
      | 'sandbox'

    const baseURL = DINELCO_URLS[env] ?? DINELCO_URLS.sandbox

    super(baseURL, context, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.config.apiKey}`,
        ...options.headers,
      },
    })
  }

  public async createCheckoutSession(
    sessionData: CreateSessionRequest
  ): Promise<CreateSessionResponse> {
    try {
      return await this.http.post<CreateSessionResponse>(
        '/dinelco-checkout/api/v1/checkout-session',
        sessionData,
        {
          metric: 'dinelco-create-session',
        }
      )
    } catch (error) {
      if (error.response?.data) {
        const dinelcoError = error.response.data as DinelcoError

        throw new Error(
          `Dinelco API Error: ${dinelcoError.message || dinelcoError.error}`
        )
      }

      throw new Error('Failed to create Dinelco checkout session')
    }
  }

  /**
   * Consulta el estado de la sesión de pago usando el sessionId (según doc oficial Dinelco)
   * @param sessionId ID único de la sesión de checkout
   */
  public async queryPaymentStatus(
    sessionId: string | number
  ): Promise<{
    sessionStatus: 'SUCCESS' | 'PENDING' | 'FAILED'
    paymentStatus?: 'APPROVED' | 'REJECTED' | 'PROCESSING'
    paymentMessage?: string
    authorizationCode?: string
    raw?: any
  }> {
    try {
      const response = await this.http.get(
        `/dinelco-checkout/api/v1/checkout-sessions/${sessionId}`,
        {
          metric: 'dinelco-query-session',
        }
      )

      // El estado de la sesión y del pago están en la respuesta
      return {
        sessionStatus: response.sessionStatus,
        paymentStatus: response.payment?.status,
        paymentMessage: response.payment?.message,
        authorizationCode: response.payment?.authorizationCode,
        raw: response,
      }
    } catch (error) {
      throw new Error('Failed to query Dinelco session status')
    }
  }
}
