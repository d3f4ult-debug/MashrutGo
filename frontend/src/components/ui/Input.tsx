import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label?: string }

export default function Input({ label, ...rest }: Props) {
  return (
    <label className="block">
      {label && <span className="text-sm text-neutral-500 mb-1 block">{label}</span>}
      <input
        className="w-full p-3 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
        {...rest}
      />
    </label>
  )
}
