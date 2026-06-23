# Dinelco Payment Provider

Payment connector for [Dinelco](https://www.dinelco.com.py), the leading payment processing platform in Paraguay. Enables VTEX stores to accept payments through Dinelco's secure checkout with native support for Paraguayan Guaraní (PYG).

## Overview

This app implements VTEX's Payment Provider Protocol using the IO framework. When a customer selects Dinelco at checkout, an embedded iframe loads Dinelco's secure payment form without redirecting the customer away from the store.

**Payment flow:**
1. Customer selects Dinelco at checkout → VTEX calls `authorize()`
2. Provider returns `undefined` + opens the Dinelco Payment App iframe
3. Customer completes payment in the Dinelco iframe
4. Dinelco notifies VTEX via `callbackUrl` → VTEX retries `authorize()`
5. Provider reads final status from VBase → returns `approved` or `denied`

## Configuration

After installing the app, configure it in the VTEX Admin under **Payments > Settings > Gateway Affiliations**:

| Field | Description |
|---|---|
| **Dinelco Secret** | Your Dinelco API key (obtained from Dinelco/Bepsa) |
| **Environment** | `sandbox` for testing, `production` for live payments |

## Requirements

- Valid Dinelco merchant account
- Dinelco Secret API key
- VTEX store in Paraguay (PYG currency support)

## Support

- Email: soporte@bepsa.com.py
- Website: https://www.bepsa.com.py
