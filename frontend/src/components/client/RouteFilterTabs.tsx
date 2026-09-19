import React from 'react'
import { OptimizationMode } from '@/types/client'
import { uz } from '@/locales/uz'

interface Props {
  activeMode: OptimizationMode
  onSelectMode: (mode: OptimizationMode) => void
}

export default function RouteFilterTabs({ activeMode, onSelectMode }: Props) {
  const tabs: { mode: OptimizationMode; label: string; icon: string }[] = [
    { mode: 'fastest', label: uz.alternatives.modes.fastest, icon: 'ri-flashlight-line' },
    { mode: 'cheapest', label: uz.alternatives.modes.cheapest, icon: 'ri-money-dollar-circle-line' },
    { mode: 'least_walking', label: uz.alternatives.modes.least_walking, icon: 'ri-walk-line' },
    { mode: 'least_transfers', label: uz.alternatives.modes.least_transfers, icon: 'ri-arrow-left-right-line' }
  ]

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar text-xs">
      {tabs.map((tab) => {
        const isActive = activeMode === tab.mode
        return (
          <button
            key={tab.mode}
            data-testid={`tab-${tab.mode}`}
            onClick={() => onSelectMode(tab.mode)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl font-medium whitespace-nowrap transition-colors min-h-[38px] ${
              isActive
                ? 'bg-blue-600 text-white shadow-sm font-semibold'
                : 'bg-white text-neutral-600 border border-neutral-200 hover:bg-neutral-50'
            }`}
          >
            <i className={`${tab.icon} text-sm`}></i>
            <span>{tab.label}</span>
          </button>
        )
      })}
    </div>
  )
}
