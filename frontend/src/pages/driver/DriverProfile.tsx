import { useAuth } from '../../contexts/AuthContext';

export function DriverProfile() {
  const { user } = useAuth();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem', padding: '2rem 1rem' }}>
      <div style={{
        width: '4rem', height: '4rem', borderRadius: '50%',
        background: 'var(--accent-subtle)', color: 'var(--accent-primary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.75rem'
      }}>
        <i className="ri-user-3-fill" />
      </div>
      <div style={{ textAlign: 'center' }}>
        <h2 style={{ margin: 0, fontSize: '1.125rem', color: 'var(--text-primary)' }}>{user?.full_name}</h2>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>{user?.email}</p>
        <p style={{ margin: '0.25rem 0 0', fontSize: '0.75rem', color: 'var(--text-tertiary)' }}>Haydovchi</p>
      </div>
    </div>
  );
}
