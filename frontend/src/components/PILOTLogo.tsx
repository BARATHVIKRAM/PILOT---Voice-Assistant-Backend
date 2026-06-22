import React from "react";

interface PILOTLogoProps {
  size?: number | string;
  style?: React.CSSProperties;
}

export function PILOTLogo({ size = 36, style }: PILOTLogoProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      style={{ display: "inline-block", verticalAlign: "middle", ...style }}
    >
      <defs>
        {/* Deep luxurious metallic gold gradient */}
        <linearGradient id="goldMetallic" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#FFEFAA" />
          <stop offset="30%" stopColor="#F5A700" />
          <stop offset="70%" stopColor="#D4900F" />
          <stop offset="100%" stopColor="#7C5E00" />
        </linearGradient>
        
        {/* Lighter gold for borders & highlights */}
        <linearGradient id="goldHighlight" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFF9D0" />
          <stop offset="100%" stopColor="#A26B00" />
        </linearGradient>

        {/* Drop shadow filter to make the circular gold coin pop */}
        <filter id="logoShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="3" stdDeviation="3" floodColor="#000000" floodOpacity="0.4" />
        </filter>
      </defs>

      {/* Connection cable / metal pipe from base to antenna */}
      <path
        d="M 42 66 L 68 66 L 68 43"
        fill="none"
        stroke="url(#goldMetallic)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Main circular coin-like badge with metallic golden borders */}
      <circle
        cx="42"
        cy="45"
        r="28"
        fill="url(#goldMetallic)"
        filter="url(#logoShadow)"
        stroke="url(#goldHighlight)"
        strokeWidth="1.5"
      />
      
      {/* Inner dark contrast circle */}
      <circle
        cx="42"
        cy="45"
        r="24"
        fill="#12100A"
        stroke="url(#goldHighlight)"
        strokeWidth="1"
      />

      {/* Precise Waveform (ECG / voice pulse visual) inside the inner circle */}
      <path
        d="M 23 45 L 30 45 L 33 34 L 37 57 L 41 33 L 45 53 L 49 39 L 52 45 L 61 45"
        fill="none"
        stroke="url(#goldMetallic)"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Microphone base adapter stand under the circle */}
      <rect x="38" y="73" width="8" height="4" rx="1.5" fill="url(#goldHighlight)" />
      <rect x="40" y="77" width="4" height="11" fill="url(#goldMetallic)" />

      {/* Wireless antenna transmitter node */}
      <circle cx="68" cy="38" r="4.5" fill="url(#goldHighlight)" />

      {/* Wi-Fi concentric wave arcs radiating outwards */}
      <path
        d="M 59 28 A 12.5 12.5 0 0 1 77 28"
        fill="none"
        stroke="url(#goldMetallic)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <path
        d="M 53 22 A 21 21 0 0 1 83 22"
        fill="none"
        stroke="url(#goldMetallic)"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
