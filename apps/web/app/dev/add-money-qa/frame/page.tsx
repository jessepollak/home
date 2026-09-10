export default function AddMoneyQaFramePage() {
  if (process.env.NODE_ENV === "production") return null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        alignContent: "center",
        justifyItems: "center",
        gap: 10,
        background: "#f7f8fa",
        color: "#0a0b0d",
        fontFamily: "Arial, sans-serif",
        textAlign: "center",
        padding: 24,
      }}
    >
      <div
        aria-hidden="true"
        style={{
          width: 42,
          height: 42,
          borderRadius: "50%",
          background: "#0052ff",
          color: "white",
          display: "grid",
          placeItems: "center",
          fontWeight: 800,
        }}
      >
        C
      </div>
      <strong>Coinbase checkout</strong>
      <span style={{ color: "#68707d", fontSize: 13 }}>
        Synthetic loaded iframe for local layout QA
      </span>
    </main>
  );
}
