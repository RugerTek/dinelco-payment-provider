import { PaymentProviderService } from '@vtex/payment-provider'

import DinelcoPaymentConnector from './dinelco-payment-connector'
import { dinelcoCreateSession } from './routes/session'

export default new PaymentProviderService({
  connector: DinelcoPaymentConnector,
  routes: {
    dinelcoCreateSession,
  },
})
