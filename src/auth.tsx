// Authentication gate.
//
// Three states, deliberately:
//   • no backend / backend open   -> render the app (standalone mock demo)
//   • backend requires auth, no session -> render the sign-in screen
//   • signed in                   -> render the app
//
// So the prototype keeps working with no server, while a real deployment is
// closed by default.
import {
  createContext, useCallback, useContext, useEffect, useState, ReactNode, FormEvent,
} from "react";
import { LogIn, Loader2 } from "lucide-react";
import * as api from "./data/api";

interface AuthCtx {
  user: api.SessionUser | null;
  authRequired: boolean;
  signOut: () => Promise<void>;
}
const Ctx = createContext<AuthCtx>({ user: null, authRequired: false, signOut: async () => {} });
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.SessionUser | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let stop = false;
    api.me().then(({ user, authRequired }) => {
      if (stop) return;
      setUser(user);
      setAuthRequired(authRequired);
      setChecking(false);
    });
    return () => { stop = true; };
  }, []);

  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  if (checking) {
    return (
      <div className="auth-screen">
        <Loader2 className="spin" size={26} />
      </div>
    );
  }

  if (authRequired && !user) {
    return <SignIn onSignedIn={setUser} />;
  }

  return <Ctx.Provider value={{ user, authRequired, signOut }}>{children}</Ctx.Provider>;
}

function SignIn({ onSignedIn }: { onSignedIn: (u: api.SessionUser) => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    const { user, error } = await api.login(username.trim(), password);
    setBusy(false);
    if (user) onSignedIn(user);
    else setError(error ?? "Sign-in failed");
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <h1>BSV EquiCare</h1>
        <p className="muted">Sign in to continue</p>

        <label>
          <span>Username</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label>
          <span>Password</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />
        </label>

        {error && <p className="auth-error" role="alert">{error}</p>}

        <button className="btn-primary" type="submit" disabled={busy}>
          {busy ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
