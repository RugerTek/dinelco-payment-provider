import { AuthorizationResponse } from '@vtex/payment-provider'

export interface DinelcoConfig {
  apiKey: string
  environment: 'sandbox' | 'production'
}

export interface CreateSessionRequest {
  clientReferenceId?: string
  amount: number
  currency: string
  targetOrigin: string
  callbackUrl?: string
  returnUrl?: string
  lineItems?: LineItem[]
  metadata?: Record<string, string | number | boolean>
  customer?: Customer
}

export interface LineItem {
  name: string
  description?: string
  price: number
  quantity: number
  img?: string
}

export interface Customer {
  customerId: string
  name?: string
  lastname?: string
  email?: string
  phone?: string
}

export interface CreateSessionResponse {
  integrityToken: string
  expirationDate: string
  sessionId: number
}

export interface DinelcoPayment {
  id: number
  status: 'PROCESSING' | 'APPROVED' | 'REJECTED'
  operationNumber: number
  authorizationCode?: number
  amount: number
  currency: string
  transactionDate: string
}

export interface PaymentInfo {
  paymentMethodType: string
  paymentMethodPayload: {
    cardBrand?: string
    cardNumber?: string
  }
}

export interface MerchantInfo {
  name: string
  document: string
  documentType: 'RUC' | 'CI' | 'CRC'
  branch: string
  legacyCode: string
}

export interface CallbackPayload {
  message: string
  clientReferenceId: string
  metadata?: Record<string, string | number | boolean>
  payment: DinelcoPayment
  paymentInfo: PaymentInfo
  merchantInfo: MerchantInfo
  merchantCustomer: {
    id: number
    merchantCustomerId: string
    name: string
    lastname: string
    email: string
    phone: string
    merchantId: number
    status: string
    createdAt: string
    updatedAt: string
  }
  customer: {
    id: number
    name: string
    lastname: string
    email: string
    phone: string
    merchantCustomerId: string
  }
}

export interface DinelcoError {
  error: string
  message: string
  statusCode: number
}

export interface PersistedPaymentData {
  response: AuthorizationResponse
  session?: CreateSessionResponse
}
