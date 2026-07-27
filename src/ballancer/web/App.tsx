import { useState } from "react";
import { ArtificialHorizon } from "../../components/ArtificialHorizon";

export function App() {
  const [roll, setRoll] = useState(0);
  const [pitch, setPitch] = useState(0);

  return (
    <main>
      <header>
        <p>FPV Ballancer</p>
        <h1>Position over horizon</h1>
        <span>Use the controls to preview roll and pitch.</span>
      </header>

      <section className="horizon-card">
        <ArtificialHorizon pitchDeg={pitch} rollDeg={roll} sampleLabel="Control preview" />

        <div className="controls">
          <label>
            <span>Roll <strong>{roll.toFixed(1)}°</strong></span>
            <input
              max="180"
              min="-180"
              onChange={(event) => setRoll(Number(event.target.value))}
              step="0.5"
              type="range"
              value={roll}
            />
          </label>
          <label>
            <span>Pitch <strong>{pitch.toFixed(1)}°</strong></span>
            <input
              max="45"
              min="-45"
              onChange={(event) => setPitch(Number(event.target.value))}
              step="0.5"
              type="range"
              value={pitch}
            />
          </label>
          <button onClick={() => { setRoll(0); setPitch(0); }}>Level horizon</button>
        </div>
      </section>
    </main>
  );
}
