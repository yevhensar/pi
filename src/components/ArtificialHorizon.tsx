export function ArtificialHorizon({
  rollDeg,
  pitchDeg,
  sampleLabel,
  hasSample = true
}: {
  rollDeg: number;
  pitchDeg: number;
  sampleLabel?: string;
  hasSample?: boolean;
}) {
  const roll = Math.max(-180, Math.min(180, rollDeg));
  const pitch = Math.max(-90, Math.min(90, pitchDeg));
  const level = Math.hypot(roll, pitch) <= 2;

  return (
    <div className="horizon-layout">
      <div
        className="artificial-horizon"
        aria-label={`Roll ${roll.toFixed(1)} degrees, pitch ${pitch.toFixed(1)} degrees`}
        role="img"
      >
        <div
          className="horizon-world"
          style={{ transform: `translateY(${pitch * 2}px) rotate(${-roll}deg)` }}
        >
          <div className="horizon-sky" />
          <div className="horizon-line" />
          <div className="horizon-ground" />
        </div>
        <div className="pitch-mark pitch-mark-up"><span>10</span></div>
        <div className="pitch-mark pitch-mark-center" />
        <div className="pitch-mark pitch-mark-down"><span>10</span></div>
        <div className="aircraft-reference"><i /><b /><i /></div>
        <div className="roll-pointer">▼</div>
      </div>

      <div className="attitude-readout">
        <div>
          <span>Roll</span>
          <strong>{hasSample ? `${roll.toFixed(1)}°` : "—"}</strong>
        </div>
        <div>
          <span>Pitch</span>
          <strong>{hasSample ? `${pitch.toFixed(1)}°` : "—"}</strong>
        </div>
        <div>
          <span>Level state</span>
          <strong className={level && hasSample ? "is-level" : ""}>
            {!hasSample ? "Waiting" : level ? "Level" : "Offset"}
          </strong>
        </div>
        <div>
          <span>Sample</span>
          <strong>{hasSample ? sampleLabel ?? "Live" : "No sample"}</strong>
        </div>
      </div>
    </div>
  );
}
