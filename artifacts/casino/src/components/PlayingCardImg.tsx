import { motion } from "framer-motion";

const BASE = import.meta.env.BASE_URL;

const RANK_NUM: Record<string, number> = {
  A: 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7,
  "8": 8, "9": 9, "10": 10, J: 11, Q: 12, K: 13,
};

const SUIT_NAME: Record<string, string> = {
  "♣": "clubs",   c: "clubs",   C: "clubs",
  "♦": "diamond", d: "diamond", D: "diamond",
  "♥": "heart",   h: "heart",   H: "heart",
  "♠": "spade",   s: "spade",   S: "spade",
};

function cardUrl(rank: string, suit: string): string {
  const num = RANK_NUM[rank];
  const suitName = SUIT_NAME[suit];
  if (!num || !suitName) return "";
  return `${BASE}cards/${suitName}_${num}.png`;
}

const CARD_BACK = `${BASE}card-back.png`;

export function PlayingCardImg({
  rank,
  suit,
  hidden,
  width = 80,
  height = 116,
  animate: anim = true,
  delay = 0,
}: {
  rank?: string;
  suit?: string;
  hidden?: boolean;
  width?: number;
  height?: number;
  animate?: boolean;
  delay?: number;
}) {
  const radius = Math.round(width * 0.1);
  const src = (!hidden && rank && suit) ? cardUrl(rank, suit) : CARD_BACK;

  const imgEl = (
    <img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "fill",
        display: "block",
        borderRadius: radius,
        boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
        userSelect: "none",
        flexShrink: 0,
      }}
      draggable={false}
      alt={hidden ? "card" : `${rank}${suit}`}
    />
  );

  if (!anim) {
    return (
      <div style={{ width, height, flexShrink: 0 }}>
        {imgEl}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ rotateY: 90, opacity: 0 }}
      animate={{ rotateY: 0, opacity: 1 }}
      transition={{ duration: 0.3, delay }}
      style={{ width, height, flexShrink: 0 }}
    >
      {imgEl}
    </motion.div>
  );
}

export function MiniPlayingCard({
  rank,
  suit,
  hidden,
  width = 50,
  height = 72,
  cssWidth,
  cssHeight,
}: {
  rank?: string;
  suit?: string;
  hidden?: boolean;
  width?: number;
  height?: number;
  cssWidth?: string;
  cssHeight?: string;
}) {
  const src = (!hidden && rank && suit) ? cardUrl(rank, suit) : CARD_BACK;

  if (cssWidth || cssHeight) {
    return (
      <div style={{ width: cssWidth, height: cssHeight, flexShrink: 0 }}>
        <img
          src={src}
          style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", borderRadius: 6, boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}
          draggable={false}
          alt={hidden ? "card" : `${rank}${suit}`}
        />
      </div>
    );
  }

  return (
    <div style={{ width, height, flexShrink: 0 }}>
      <img
        src={src}
        style={{ width: "100%", height: "100%", objectFit: "fill", display: "block", borderRadius: Math.round(width * 0.1), boxShadow: "0 3px 10px rgba(0,0,0,0.5)" }}
        draggable={false}
        alt={hidden ? "card" : `${rank}${suit}`}
      />
    </div>
  );
}
