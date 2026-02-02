import {
    AuthorizationRequest,
    AuthorizationResponse,
    CancellationRequest,
    CancellationResponse,
    InboundRequest,
    InboundResponse,
    PaymentProvider,
    RefundRequest,
    RefundResponse,
    SettlementRequest,
    SettlementResponse,
    // ...
} from '@vtex/payment-provider'
import { DinelcoClient } from './clients/dinelco-client'
import { DinelcoConfig } from './types/dinelco'

export class DinelcoPaymentConnector extends PaymentProvider {

    async authorize(authorization: AuthorizationRequest): Promise<AuthorizationResponse> {

        const { transactionId } = authorization

        // TODO
        // if (paymentMethodCustomCode !== 'dinelco') { 
        //     return {
        //         acquirer: "",
        //         code: "0001",
        //         message: "",
        //         paymentId: "",
        //         status: "denied",
        //         tid: transactionId,
        //         authorizationId: "",
        //     } as FailedAuthorization;
        // }



        // dinelco call here
        const client = this.createDinelcoClient(authorization)
        const amount = Math.round(authorization.value)
        const sessionData = {
            clientReferenceId: authorization.paymentId,
            amount,
            currency: 'PYG',
            targetOrigin: authorization.callbackUrl || 'https://checkout.vtex.com',
            // Callback URL: Dinelco enviará notificaciones aquí (opcional)
            // Por ahora lo dejamos undefined y usaremos polling/consultas para verificar el estado
            callbackUrl: this.getDinelcoConfig(authorization).callbackUrl, // Solo si el merchant lo configura
            returnUrl: authorization.returnUrl,
            lineItems: [
                {
                    name: 'Compra VTEX',
                    description: `Pago para orden ${authorization.orderId ||
                        authorization.paymentId}`,
                    price: amount,
                    quantity: 1,
                },
            ],
            metadata: {
                orderId: authorization.orderId || '',
                paymentId: authorization.paymentId,
                vtexAccount: this.context.vtex.account,
            },
            customer: {
                customerId: authorization.paymentId,
                name: authorization.miniCart?.buyer?.firstName || '',
                lastname: authorization.miniCart?.buyer?.lastName || '',
                email: authorization.miniCart?.buyer?.email || '',
                phone: authorization.miniCart?.buyer?.phone || '',
            },
        }

        const sessionResponse = await client.createCheckoutSession(sessionData)


        const response: AuthorizationResponse = {
            status: 'undefined',
            paymentId: authorization.paymentId,
            acquirer: 'Dinelco',
            code: 'undefined',
            message: null,
            tid: 'TID-' + transactionId.toString() + '-ASYNC',
            authorizationId: sessionResponse.sessionId.toString(),
            nsu: "NSU-171BE62CB7-ASYNC",
            delayToAutoSettle: 21600,
            delayToAutoSettleAfterAntifraud: 1800,
            delayToCancel: 21600,
            // Payment App Data - VTEX usará esto para mostrar el Payment App
            paymentAppData: {
                appName: 'bepsapartnerpy.dinelco-payment-app', // vendor.appName según manifest
                payload: JSON.stringify({
                    token: sessionResponse.integrityToken,
                    paymentId: authorization.paymentId,
                    sessionId: sessionResponse.sessionId,
                    environment: this.getDinelcoConfig().environment,
                    validateUrl:
                        this.getDinelcoConfig().environment === 'sandbox'
                            ? 'https://dev-sgwf-01.bepsa.com.py/d/api/checkout-session/validate'
                            : 'https://checkout.dinelco.com.py/d/api/checkout-session/validate',
                    amount: sessionData.amount,
                    currency: sessionData.currency,
                }),
            },
        }

        return response;
    }

    async cancel(cancellation: CancellationRequest): Promise<CancellationResponse> {
        return {
            code: '0000',
            message: null,
            cancellationId: cancellation.transactionId,
            paymentId: cancellation.paymentId,
        } as CancellationResponse;
        // throw new Error('Method not implemented.');
    }

    async refund(refund: RefundRequest): Promise<RefundResponse> {
        return {
            value: 10,
            code: '0000',
            message: null,
            paymentId: refund.paymentId,
            refundId: '1',
            requestId: refund.requestId
        } as RefundResponse;
    }

    async settle(settlement: SettlementRequest): Promise<SettlementResponse> {
        return {
            code: '0000',
            message: '',
            paymentId: settlement.paymentId,
            requestId: '',
            settleId: '',
            value: 0
        } as SettlementResponse;
    }

    async inbound?(inbound: InboundRequest): Promise<InboundResponse> {
        return {
            code: '',
            paymentId: inbound.paymentId,
            message: null
        } as InboundResponse;
    }


    private createDinelcoClient(request?: any): DinelcoClient {
        const config = this.getDinelcoConfig(request)

        return new DinelcoClient(this.context.vtex, { config })
    }

    private getDinelcoConfig(request?: any): DinelcoConfig {
        // En VTEX IO, los custom fields vienen en el request del payment provider
        // Método 1: Custom Fields (producción) - vienen en request.customFields
        const customFields = request?.customFields || {}

        // Método 2: Variables de entorno (desarrollo local con vtex link)
        const apiKey =
            customFields['API Key'] || // Desde admin VTEX (producción)
            process.env.DINELCO_API_KEY || // Desarrollo local
            'di_sk_test_fallback' // Fallback para testing

        const environment =
            // eslint-disable-next-line dot-notation
            customFields['Environment'] || // Desde admin VTEX
            process.env.DINELCO_ENVIRONMENT || // Desarrollo local
            'sandbox'

        const callbackUrl =
            customFields['Callback URL'] || process.env.DINELCO_CALLBACK_URL // Desarrollo local

        // eslint-disable-next-line no-console
        console.log('Dinelco Config:', {
            hasApiKey: !!apiKey,
            environment,
            customFieldsKeys: Object.keys(customFields),
        })

        return {
            apiKey,
            environment: environment as 'sandbox' | 'production',
            callbackUrl,
        }
    }
}