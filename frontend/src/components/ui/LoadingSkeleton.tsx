import React from 'react'

export function LoadingSkeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-neutral-100 rounded ${className}`} />
}

export default LoadingSkeleton
