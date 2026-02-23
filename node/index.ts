import { PaymentProviderService } from '@vtex/payment-provider'

import DinelcoPaymentConnector from './dinelco-payment-connector'

export default new PaymentProviderService({
  connector: DinelcoPaymentConnector,
})
