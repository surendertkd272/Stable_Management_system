import Link from "next/link";

export default function NotFound() {
  return (
    <div className="card" style={{ textAlign: "center", padding: 48 }}>
      <h3>Page not found</h3>
      <p className="muted" style={{ marginTop: 8 }}>
        That address doesn&apos;t match anything in EquiCare.
      </p>
      <Link href="/" className="btn-primary" style={{ display: "inline-flex", marginTop: 18 }}>
        Back to dashboard
      </Link>
    </div>
  );
}
