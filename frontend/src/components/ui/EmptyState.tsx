import React from 'react'

export default function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="text-center p-8">
      <div className="mx-auto w-24 h-24 bg-neutral-50 rounded-full flex items-center justify-center">⚠️</div>
      <h3 className="mt-4 text-lg font-semibold">{title}</h3>
      {description && <p className="text-sm text-neutral-500 mt-2">{description}</p>}
    </div>
  )
}
