// Factory for the office Finance provider. Add another licensed provider
// here later — the rest of the codebase only depends on FinanceProvider.
import type { FinanceProvider } from './provider.ts'
import { createPaystackFinanceProvider } from './paystack.ts'

export * from './provider.ts'

export function getFinanceProvider(id = 'paystack'): FinanceProvider {
  switch (id) {
    case 'paystack':
      return createPaystackFinanceProvider()
    default:
      throw new Error(`finance provider: unknown provider "${id}"`)
  }
}
