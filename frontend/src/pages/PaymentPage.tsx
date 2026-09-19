import React, { useState } from 'react'
import PaymentModal from '@/components/client/PaymentModal'
import { uz } from '@/locales/uz'

export default function PaymentPage() {
  const [isModalOpen, setIsModalOpen] = useState(true)

  return (
    <div className="max-w-md mx-auto py-8 text-center space-y-6">
      <div className="w-20 h-20 rounded-3xl bg-blue-50 text-blue-600 flex items-center justify-center mx-auto text-4xl shadow-sm">
        <i className="ri-qr-scan-2-line"></i>
      </div>

      <div className="space-y-1">
        <h1 className="text-xl font-extrabold text-neutral-900">{uz.payment.title}</h1>
        <p className="text-xs text-neutral-500">
          Avtobus yoki marshrutkadagi QR kodni skanerlang yoki raqamini kiriting
        </p>
      </div>

      <button
        onClick={() => setIsModalOpen(true)}
        className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl text-sm transition-colors shadow-md flex items-center justify-center gap-2 min-h-[44px]"
      >
        <i className="ri-qr-code-line text-lg"></i>
        <span>To‘lov oynasini ochish</span>
      </button>

      <PaymentModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  )
}
