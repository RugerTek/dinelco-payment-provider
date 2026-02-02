import { PaymentProviderService } from '@vtex/payment-provider'
import { DinelcoPaymentConnector } from './dinelco-payment-connector'

// class DinelcoPaymentProviderService<T extends IOClients, U extends PaymentProviderState, V extends ParamsContext> extends PaymentProviderService<T, U, V> {
  
// }

export default new PaymentProviderService({
  connector: DinelcoPaymentConnector,

  
})
