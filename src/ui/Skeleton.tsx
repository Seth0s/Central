/** Shared loading placeholders — shimmer only for in-flight waits. */

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`skeleton skeleton-block ${className}`.trim()} aria-hidden />;
}

export function SkeletonLines({ n = 4, className = "" }: { n?: number; className?: string }) {
  return (
    <div className={`skeleton-lines ${className}`.trim()} aria-hidden>
      {Array.from({ length: n }, (_, i) => (
        <div
          key={i}
          className="skeleton skeleton-line"
          style={{ width: `${72 - (i % 3) * 12}%` }}
        />
      ))}
    </div>
  );
}

export function SkeletonPane({ label = "A carregar…" }: { label?: string }) {
  return (
    <div className="skeleton-pane" role="status" aria-busy="true" aria-label={label}>
      <SkeletonBlock className="skeleton-pane-hero" />
      <SkeletonLines n={5} />
    </div>
  );
}

const Skeleton = { Block: SkeletonBlock, Lines: SkeletonLines, Pane: SkeletonPane };
export default Skeleton;
