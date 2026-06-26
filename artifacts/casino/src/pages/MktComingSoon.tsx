import { motion } from "framer-motion";
import { Hourglass } from "lucide-react";

interface Props {
  title: string;
}

export function MktComingSoon({ title }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center"
      style={{ minHeight: "calc(100vh - 56px)", padding: "40px 24px" }}
    >
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: "easeOut" }}
        className="flex flex-col items-center text-center"
        style={{ maxWidth: 420 }}
      >
        {/* Icon */}
        <div
          style={{
            width: 72, height: 72, borderRadius: "50%",
            background: "rgba(232,64,10,0.08)",
            border: "1.5px solid rgba(232,64,10,0.25)",
            boxShadow: "0 0 32px rgba(232,64,10,0.12)",
            display: "flex", alignItems: "center", justifyContent: "center",
            marginBottom: 28,
          }}
        >
          <Hourglass size={30} style={{ color: "#e8400a", filter: "drop-shadow(0 0 8px rgba(232,64,10,0.7))" }} />
        </div>

        {/* Heading */}
        <h1
          style={{
            fontFamily: "Rajdhani, sans-serif",
            fontWeight: 900,
            fontSize: "clamp(32px, 5vw, 48px)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "#fff",
            textShadow: "0 0 24px rgba(232,64,10,0.55), 0 0 48px rgba(232,64,10,0.2)",
            marginBottom: 12,
            lineHeight: 1,
          }}
        >
          Coming Soon
        </h1>

        {/* Accent bar */}
        <div
          style={{
            width: 48, height: 2, borderRadius: 2,
            background: "linear-gradient(90deg, transparent, #e8400a, transparent)",
            boxShadow: "0 0 8px rgba(232,64,10,0.6)",
            marginBottom: 18,
          }}
        />

        {/* Subtitle */}
        <p
          style={{
            fontSize: 13,
            color: "rgba(255,255,255,0.38)",
            letterSpacing: "0.04em",
            lineHeight: 1.6,
            fontFamily: "Rajdhani, sans-serif",
            fontWeight: 600,
          }}
        >
          This section is currently under development.
        </p>

        {/* Section label */}
        <div
          style={{
            marginTop: 32,
            padding: "6px 16px",
            borderRadius: 20,
            background: "rgba(232,64,10,0.06)",
            border: "1px solid rgba(232,64,10,0.15)",
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "rgba(232,64,10,0.6)",
            fontFamily: "Rajdhani, sans-serif",
          }}
        >
          {title}
        </div>
      </motion.div>
    </div>
  );
}
