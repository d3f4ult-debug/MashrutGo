import React from 'react'

type Props = React.InputHTMLAttributes<HTMLInputElement> & { label?: string }

export default function SearchInput({ label, ...rest }: Props) {
  return (
    <label className="block">
      {label && <span className="text-sm text-neutral-500 mb-1 block">{label}</span>}
      <div className="relative">
        <input
          className="w-full p-3 pl-10 border border-neutral-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
          {...rest}
        />
        <div className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400">
          <i className="ri-search-line" />
        </div>
      </div>
    </label>
  )
}

