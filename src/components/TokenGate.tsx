import { useState } from "react";

export function TokenGate({
  error,
  onUnlock
}: {
  error: string;
  onUnlock: (token: string) => Promise<void>;
}) {
  const [token, setToken] = useState("");
  const [unlocking, setUnlocking] = useState(false);

  return (
    <main className="unlock-page">
      <form
        className="unlock-card"
        onSubmit={async (event) => {
          event.preventDefault();
          setUnlocking(true);
          try {
            await onUnlock(token);
          } catch {
            // The parent renders the validation error.
          } finally {
            setUnlocking(false);
          }
        }}
      >
        <span className="brand-icon">π</span>
        <p className="eyebrow">Encrypted fleet</p>
        <h1>Unlock the dashboard</h1>
        <p>
          Enter the shared message token. It is retained only for this browser tab.
        </p>
        <label>
          Message token
          <input
            autoComplete="off"
            autoFocus
            onChange={(event) => setToken(event.target.value)}
            placeholder="43-character token"
            spellCheck={false}
            type="password"
            value={token}
          />
        </label>
        {error && <div className="unlock-error">{error}</div>}
        <button disabled={unlocking || !token.trim()} type="submit">
          {unlocking ? "Checking…" : "Unlock"}
        </button>
      </form>
    </main>
  );
}
