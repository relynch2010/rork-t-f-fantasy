import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/lib/auth";

export default function Login() {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [email, setEmail] = useState<string>("");
  const [password, setPassword] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [busy, setBusy] = useState<boolean>(false);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "in") await signIn(email.trim(), password);
      else await signUp(email.trim(), password, name.trim());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="lane-lines relative hidden overflow-hidden lg:flex lg:flex-col lg:justify-between" style={{ background: "linear-gradient(160deg, #04140B 0%, #0B2A18 70%, #0E3A22 100%)" }}>
        <div className="absolute -left-40 top-20 h-[520px] w-[520px] rounded-full bg-td-green/20 blur-3xl" />
        <div className="relative p-10">
          <div className="flex items-center gap-3">
            <img src="/icon.png" alt="" className="h-11 w-11 rounded-2xl" />
            <span className="font-display text-2xl tracking-[0.14em]">T&amp;F FANTASY</span>
          </div>
        </div>
        <div className="relative p-10 pb-16">
          <p className="eyebrow text-td-green">High school track &amp; field</p>
          <h1 className="font-display mt-2 text-7xl leading-[0.9]">Draft your squad.<br />Score every split.</h1>
          <p className="mt-5 max-w-md text-lg text-[#E8F5EC]/70">Live meets, per-event lineup locks, projections and win odds. The same leagues as the iPhone app.</p>
          <div className="mt-8 flex gap-8">
            {[["6", "Draft rounds"], ["Live", "AthleticLIVE scoring"], ["1", "Account for app + web"]].map(([a, b]) => (
              <div key={b}><p className="num text-4xl text-td-green">{a}</p><p className="text-sm text-[#E8F5EC]/60">{b}</p></div>
            ))}
          </div>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="panel w-full max-w-md p-8">
          <div className="mb-6 flex items-center gap-3 lg:hidden">
            <img src="/icon.png" alt="" className="h-10 w-10 rounded-xl" />
            <span className="font-display text-xl tracking-[0.14em]">T&amp;F FANTASY</span>
          </div>
          <h2 className="font-display text-4xl">{mode === "in" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Use the same email and password as the app.</p>
          <div className="mt-6 space-y-4">
            {mode === "up" && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Your name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={32} />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pw">Password</Label>
              <Input id="pw" type="password" autoComplete={mode === "in" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={mode === "up" ? 8 : 1} />
            </div>
          </div>
          <Button type="submit" className="mt-6 h-12 w-full rounded-full text-base font-bold" disabled={busy}>
            {busy && <Loader2 className="animate-spin" />} {mode === "in" ? "Sign in" : "Create account"}
          </Button>
          <button type="button" className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "in" ? "up" : "in")}>
            {mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}
          </button>
          {mode === "in" && <p className="mt-3 text-center text-xs text-td-faint">Forgot your password? Reset it from the sign-in screen in the app.</p>}
        </form>
      </div>
    </div>
  );
}
