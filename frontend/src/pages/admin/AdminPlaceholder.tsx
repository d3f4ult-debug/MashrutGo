/**
 * Admin placeholder page — used for admin routes not yet implemented.
 */
export function AdminPlaceholder({ title, icon }: { title: string; icon: string }) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      height: '60vh', gap: '0.75rem', color: 'var(--text-tertiary)'
    }}>
      <i className={icon} style={{ fontSize: '2.5rem' }} />
      <p style={{ margin: 0, fontSize: '0.875rem' }}>{title} — keyingi bosqichda qo'shiladi</p>
    </div>
  );
}
