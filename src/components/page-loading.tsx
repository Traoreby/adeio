export function PageLoading({ label = "Chargement de la page" }: { label?: string }) {
  return <div className="page-loading container" role="status" aria-label={label}>
    <span className="sr-only">{label}</span>
    <div className="loading-title" />
    <div className="loading-copy" />
    <div className="loading-card-grid"><i /><i /><i /></div>
  </div>;
}
