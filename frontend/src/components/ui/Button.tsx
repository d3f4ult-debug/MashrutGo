import React from 'react'

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' }

export default function Button({ variant = 'primary', children, ...rest }: Props) {
  const base = 'inline-flex items-center justify-center px-4 py-2 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-offset-2'
  const cls =
    variant === 'primary'
      ? `${base} bg-primary text-white hover:bg-primary-600 focus:ring-primary`
      : `${base} bg-transparent text-neutral-700 border border-neutral-200`
  return (
    <button className={cls} {...rest}>
      {children}
    </button>
  )
}
