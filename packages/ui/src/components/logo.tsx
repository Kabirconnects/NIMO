import * as React from "react"

type LogoProps = {
  /** Size of the character in px (or any CSS size). */
  size?: number | string
  /**
   * "hover" – animate when the pointer enters (default)
   * "loop"  – animate every `interval` ms
   * "none"  – static
   */
  animation?: "hover" | "loop" | "none"
  /** Delay between animations for animation="loop", in ms. */
  interval?: number
  /** Animate once when the logo first appears. */
  playOnMount?: boolean
  /** Show the RAISE. wordmark next to the character. */
  showWordmark?: boolean
  /** Text for the wordmark. */
  wordmark?: string
  /** Classes for the outer element. Set the colour with text-* here. */
  className?: string
  /** Classes for the wordmark text. */
  wordmarkClassName?: string
}

const css = `
.raise-logo-body,
.raise-logo-eye {
  transform-box: fill-box;
}
.raise-logo-body { transform-origin: 50% 100%; }
.raise-logo-eye  { transform-origin: center; }

.raise-logo-body[data-playing="true"] {
  animation: raise-logo-hop 833ms ease-in-out 1 both;
}
.raise-logo-eye[data-playing="true"] {
  animation: raise-logo-blink 833ms ease-in-out 1 both;
}

@keyframes raise-logo-hop {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  15%      { transform: translateY(0) scale(1.08, 0.9); }
  35%      { transform: translateY(-2px) scale(0.94, 1.08); }
  55%      { transform: translateY(0) scale(1.06, 0.94); }
  75%      { transform: translateY(0) scale(0.98, 1.03); }
}
@keyframes raise-logo-blink {
  0%, 10%  { transform: scaleY(1); }
  16%, 28% { transform: scaleY(0.2); }
  36%, 56% { transform: scaleY(1); }
  66%, 72% { transform: scaleY(0.02); }
  82%, 100%{ transform: scaleY(1); }
}
@media (prefers-reduced-motion: reduce) {
  .raise-logo-body[data-playing="true"],
  .raise-logo-eye[data-playing="true"] { animation: none; }
}
`

function Eye({
  x,
  playing,
  onEnd,
}: {
  x: number
  playing: boolean
  onEnd?: () => void
}) {
  return (
    <g transform={`translate(${x} 10)`}>
      <path
        d="M 0 -1 L 0 0 L 0 1"
        className="raise-logo-eye"
        data-playing={playing}
        onAnimationEnd={onEnd}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  )
}

export function Logo({
  size = 32,
  animation = "hover",
  interval = 4000,
  playOnMount = true,
  showWordmark = false,
  wordmark = "RAISE",
  className,
  wordmarkClassName,
}: LogoProps) {
  const [playing, setPlaying] = React.useState(false)

  const play = React.useCallback(() => {
    if (animation === "none") return
    setPlaying(true)
  }, [animation])

  // Animate once on mount
  React.useEffect(() => {
    if (playOnMount) play()
  }, [playOnMount, play])

  // Animate repeatedly
  React.useEffect(() => {
    if (animation !== "loop") return
    const id = window.setInterval(play, interval)
    return () => window.clearInterval(id)
  }, [animation, interval, play])

  const stop = () => setPlaying(false)

  return (
    <span
      className={["inline-flex items-center gap-2.5", className]
        .filter(Boolean)
        .join(" ")}
      onMouseEnter={animation === "hover" && !playing ? play : undefined}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className="shrink-0 overflow-visible"
        role={showWordmark ? undefined : "img"}
        aria-label={showWordmark ? undefined : wordmark}
        aria-hidden={showWordmark ? true : undefined}
      >
        <style>{css}</style>

        <g className="raise-logo-body" data-playing={playing}>
          {/* Box body */}
          <rect
            x={3}
            y={3}
            width={18}
            height={18}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinejoin="miter"
          />
          {/* Eyes */}
          <Eye x={11} playing={playing} onEnd={stop} />
          <Eye x={16} playing={playing} />
        </g>
      </svg>

      {showWordmark && (
        <span
          className={
            wordmarkClassName ??
            "font-display text-ink text-2xl leading-none tracking-wide"
          }
        >
          {wordmark}
          <span className="text-signal">.</span>
        </span>
      )}
    </span>
  )
}

export default Logo
