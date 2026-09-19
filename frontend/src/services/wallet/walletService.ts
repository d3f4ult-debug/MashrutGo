// Wallet and Payment Service for MashrutGo Client
import { PaymentReceipt, ResolvedVehicle, WalletTransaction } from '@/types/client'

const WALLET_STORAGE_KEY = 'mashrutgo_wallet_balance'
const TRANSACTIONS_STORAGE_KEY = 'mashrutgo_wallet_transactions'

// Sample registered fleet for Andijon to resolve QR / NFC / plates
export const REGISTERED_VEHICLES: ResolvedVehicle[] = [
  {
    vehicleId: 'v-15-1',
    licensePlate: '60 A 105 AA',
    routeNumber: '15',
    uyushmaName: 'Vodiy Trans Servis MCHJ',
    fareSoM: 2000,
    driverName: 'Otabek Karimov'
  },
  {
    vehicleId: 'v-15-2',
    licensePlate: '60 B 220 BA',
    routeNumber: '15',
    uyushmaName: 'Vodiy Trans Servis MCHJ',
    fareSoM: 2000,
    driverName: 'Dilshodbek Tursunov'
  },
  {
    vehicleId: 'v-22-1',
    licensePlate: '60 D 404 DA',
    routeNumber: '22',
    uyushmaName: 'Andijon Yo‘lovchi Tashish DUK',
    fareSoM: 2000,
    driverName: 'Bobur Mirzayev'
  },
  {
    vehicleId: 'v-33-1',
    licensePlate: '60 F 616 FA',
    routeNumber: '33',
    uyushmaName: 'Oltin Vodiy Ekspress',
    fareSoM: 2000,
    driverName: 'Rustam Rahmonov'
  },
  {
    vehicleId: 'v-7-1',
    licensePlate: '60 G 707 GA',
    routeNumber: '7',
    uyushmaName: 'Andijon Yo‘lovchi Tashish DUK',
    fareSoM: 2000,
    driverName: 'Sherzod Aliyev'
  }
]

class WalletService {
  private balance: number
  private transactions: WalletTransaction[]
  private activePaymentRequests: Set<string> = new Set()

  constructor() {
    this.balance = this.loadBalance()
    this.transactions = this.loadTransactions()
  }

  private loadBalance(): number {
    try {
      const saved = localStorage.getItem(WALLET_STORAGE_KEY)
      if (saved !== null) {
        return parseInt(saved, 10)
      }
    } catch (e) {}
    return 24000 // default initial demo balance
  }

  private loadTransactions(): WalletTransaction[] {
    try {
      const saved = localStorage.getItem(TRANSACTIONS_STORAGE_KEY)
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (e) {}
    return [
      {
        id: 'tx-init-1',
        type: 'topup',
        amountSoM: 20000,
        description: 'Click orqali hisob to‘ldirildi',
        createdAtEpochMs: Date.now() - 86400000,
        status: 'success'
      },
      {
        id: 'tx-init-2',
        type: 'ride_payment',
        amountSoM: -2000,
        description: '15-marshrut yo‘l haqi to‘lovi',
        createdAtEpochMs: Date.now() - 43200000,
        status: 'success'
      }
    ]
  }

  private persist() {
    try {
      localStorage.setItem(WALLET_STORAGE_KEY, this.balance.toString())
      localStorage.setItem(TRANSACTIONS_STORAGE_KEY, JSON.stringify(this.transactions))
    } catch (e) {}
  }

  getBalance(): number {
    return this.balance
  }

  getTransactions(): WalletTransaction[] {
    return [...this.transactions]
  }

  /**
   * Top up wallet using Click provider
   */
  async topUpWithClick(
    amountSoM: number
  ): Promise<{ success: boolean; transaction?: WalletTransaction; error?: string }> {
    if (!navigator.onLine) {
      return { success: false, error: 'Moliyaviy amallarni bajarish uchun internet zarur' }
    }
    if (amountSoM < 1000) {
      return { success: false, error: 'Minimal to‘ldirish summasi: 1 000 so‘m' }
    }

    // Create pending transaction
    const txId = `click-topup-${Date.now()}`
    const tx: WalletTransaction = {
      id: txId,
      type: 'topup',
      amountSoM,
      description: `Click orqali to‘ldirish (${amountSoM.toLocaleString('uz-UZ')} so‘m)`,
      createdAtEpochMs: Date.now(),
      status: 'pending'
    }

    this.transactions.unshift(tx)
    this.persist()

    // Simulate Click checkout & instant reconciliation
    await new Promise((resolve) => setTimeout(resolve, 1200))

    tx.status = 'success'
    this.balance += amountSoM
    this.persist()

    return { success: true, transaction: tx }
  }

  /**
   * Resolve vehicle by QR string, NFC text, or license plate / number query
   */
  resolveVehicle(input: string): ResolvedVehicle | null {
    const clean = input.trim().toLowerCase().replace(/\s+/g, '')
    
    // Check direct ID or plate match
    const found = REGISTERED_VEHICLES.find((v) => {
      const plate = v.licensePlate.toLowerCase().replace(/\s+/g, '')
      const id = v.vehicleId.toLowerCase()
      const route = v.routeNumber.toLowerCase()
      return plate.includes(clean) || id === clean || clean.includes(id) || (clean === route)
    })

    if (found) return found

    // Fallback: if query is a route number (e.g. "15"), generate a realistic registered vehicle
    if (/^\d+$/.test(clean)) {
      return {
        vehicleId: `v-${clean}-custom`,
        licensePlate: `60 A ${Math.floor(100 + Math.random() * 899)} AA`,
        routeNumber: clean,
        uyushmaName: 'Andijon Shahar Yo‘lovchi Tashish',
        fareSoM: 2000,
        driverName: 'Haydovchi'
      }
    }

    return null
  }

  /**
   * Pay transport fare with double-submit protection (idempotency key)
   */
  async payTransportFare(
    vehicle: ResolvedVehicle,
    method: 'wallet' | 'click' = 'wallet',
    idempotencyKey?: string
  ): Promise<{ success: boolean; receipt?: PaymentReceipt; error?: string }> {
    if (!navigator.onLine) {
      return { success: false, error: 'To‘lov qilish uchun internet aloqasi zarur' }
    }

    const key = idempotencyKey || `${vehicle.vehicleId}-${Date.now()}`
    if (this.activePaymentRequests.has(key)) {
      return { success: false, error: 'To‘lov qayta ishlanmoqda, kuting...' }
    }

    this.activePaymentRequests.add(key)

    try {
      if (method === 'wallet') {
        if (this.balance < vehicle.fareSoM) {
          return { success: false, error: 'Hamyonda mablag‘ yetarli emas' }
        }

        // Simulate network processing
        await new Promise((resolve) => setTimeout(resolve, 800))

        this.balance -= vehicle.fareSoM
        const tx: WalletTransaction = {
          id: `fare-${Date.now()}`,
          type: 'ride_payment',
          amountSoM: -vehicle.fareSoM,
          description: `${vehicle.routeNumber}-marshrut (${vehicle.licensePlate}) to‘lovi`,
          createdAtEpochMs: Date.now(),
          status: 'success',
          referenceId: vehicle.vehicleId
        }
        this.transactions.unshift(tx)
        this.persist()

        const receipt: PaymentReceipt = {
          paymentId: tx.id,
          vehicle,
          paidAmountSoM: vehicle.fareSoM,
          paymentMethod: 'wallet',
          paidAtEpochMs: Date.now(),
          status: 'success'
        }

        return { success: true, receipt }
      } else {
        // Direct Click payment
        await new Promise((resolve) => setTimeout(resolve, 1000))
        const receipt: PaymentReceipt = {
          paymentId: `click-fare-${Date.now()}`,
          vehicle,
          paidAmountSoM: vehicle.fareSoM,
          paymentMethod: 'click',
          paidAtEpochMs: Date.now(),
          status: 'success'
        }
        return { success: true, receipt }
      }
    } finally {
      this.activePaymentRequests.delete(key)
    }
  }
}

export const walletService = new WalletService()
