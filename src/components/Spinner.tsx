/** Small inline loading spinner for buttons/actions. */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-label="loading" />;
}
