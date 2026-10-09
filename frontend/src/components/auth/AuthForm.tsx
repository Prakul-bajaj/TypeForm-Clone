"use client";
import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { safeNext } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Spinner } from "@/components/ui";
import ColorModeButton from "@/components/ColorModeButton";
import { useAuth } from "./AuthProvider";

type Mode = "login" | "signup";
type Errors = Partial<Record<"name" | "email" | "password", string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** One form for both /login and /signup (same layout, a couple of fields differ). */
export default function AuthForm({ mode }: { mode: Mode }) {
  const isSignup = mode === "signup";
  const { status, login, signup } = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""); // read after mount so server and client HTML match
  useEffect(() => setSearch(window.location.search), []);

  const next = () => safeNext(new URLSearchParams(window.location.search).get("next"));

  // Already signed in (or just became signed in) → go to the app.
  useEffect(() => {
    if (status === "authed") router.replace(next());
  }, [status, router]); // eslint-disable-line react-hooks/exhaustive-deps

  const validate = (): Errors => {
    const e: Errors = {};
    if (isSignup && !name.trim()) e.name = "Please enter your name";
    if (!email.trim()) e.email = "Please fill this in";
    else if (!EMAIL_RE.test(email.trim())) e.email = "Hmm... that email address looks invalid";
    if (!password) e.password = "Please fill this in";
    else if (isSignup && password.length < 8) e.password = "Use at least 8 characters";
    return e;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      const user = isSignup ? await signup(name.trim(), email.trim(), password) : await login(email.trim(), password);
      toast.success(isSignup ? `Welcome, ${user.name.split(" ")[0]}!` : `Welcome back, ${user.name.split(" ")[0]}`);
      router.replace(next());
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Something went wrong");
      setBusy(false);
    }
  };

  const clear = (k: keyof Errors) => setErrors((p) => (p[k] ? { ...p, [k]: undefined } : p));
  const other = isSignup ? "/login" : "/signup";
  const otherWithNext = other + search; // keep ?next=… when switching between log in / sign up

  return (
    <div className="auth">
      <section className="auth-left">
        <div className="auth-top">
          <Link href="/" className="logo"><i /> Typeform Clone</Link>
          <ColorModeButton />
        </div>

        <form className="auth-card" onSubmit={submit} noValidate>
          <h1>{isSignup ? "Create your account" : "Log in to your account"}</h1>
          <p className="muted">
            {isSignup ? "Build forms people actually enjoy answering." : "Welcome back! Pick up where you left off."}
          </p>

          {formError && <div className="auth-alert" role="alert">{formError}</div>}

          {isSignup && (
            <div className={"field" + (errors.name ? " has-error" : "")}>
              <label htmlFor="name">Full name</label>
              <input id="name" className="input" autoComplete="name" autoFocus value={name} maxLength={120}
                onChange={(e) => { setName(e.target.value); clear("name"); }} aria-invalid={!!errors.name} />
              {errors.name && <span className="field-error">{errors.name}</span>}
            </div>
          )}

          <div className={"field" + (errors.email ? " has-error" : "")}>
            <label htmlFor="email">Email</label>
            <input id="email" type="email" className="input" autoComplete="email" autoFocus={!isSignup} value={email}
              onChange={(e) => { setEmail(e.target.value); clear("email"); }} aria-invalid={!!errors.email} />
            {errors.email && <span className="field-error">{errors.email}</span>}
          </div>

          <div className={"field" + (errors.password ? " has-error" : "")}>
            <label htmlFor="password">Password</label>
            <div className="pw-wrap">
              <input id="password" type={show ? "text" : "password"} className="input"
                autoComplete={isSignup ? "new-password" : "current-password"} value={password} maxLength={128}
                onChange={(e) => { setPassword(e.target.value); clear("password"); }} aria-invalid={!!errors.password} />
              <button type="button" className="icon-btn" aria-label={show ? "Hide password" : "Show password"} onClick={() => setShow((s) => !s)}>
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {errors.password ? <span className="field-error">{errors.password}</span> : isSignup && <span className="field-hint">At least 8 characters</span>}
          </div>

          <button className="btn btn-primary btn-lg auth-submit" type="submit" disabled={busy}>
            {busy ? <Spinner size={16} /> : isSignup ? "Create account" : "Log in"}
          </button>

          <p className="auth-switch">
            {isSignup ? "Already have an account? " : "Don't have an account? "}
            <Link href={otherWithNext}>{isSignup ? "Log in" : "Sign up"}</Link>
          </p>
        </form>
      </section>

      <aside className="auth-right" aria-hidden>
        <div className="mock">
          <small>1 →</small>
          <h2>What will you build today?</h2>
          <div className="mock-opts">
            <span><kbd>A</kbd> A customer survey</span>
            <span><kbd>B</kbd> A job application</span>
            <span><kbd>C</kbd> A quiz</span>
          </div>
          <div className="mock-btn">OK ✓</div>
        </div>
      </aside>
    </div>
  );
}
