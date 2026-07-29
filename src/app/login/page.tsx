import { redirect } from "next/navigation";
import { getProfile } from "@/lib/supabase/server";
import { LogoMark } from "@/components/logo";
import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in" };

const STEPS = [
  { n: 1, text: "Order what you need" },
  { n: 2, text: "We pack it for you" },
  { n: 3, text: "Collect & go" },
];

export default async function LoginPage() {
  const profile = await getProfile();
  if (profile) redirect("/");

  return (
    <main className="flex min-h-screen">
      {/* ── Brand panel — orange-led (the invoice app runs the same layout navy-led) ── */}
      <aside className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-gradient-to-br from-brand via-[#d9440f] to-[#8a2a08] text-white lg:flex">
        {/* navy corner glow mirroring the invoice app's maroon one */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-[#2E3192] opacity-40 blur-3xl"
        />
        <div aria-hidden className="brand-grid absolute inset-0" />

        <div className="relative z-10 p-10">
          <span className="inline-flex items-center gap-3">
            <span className="rounded-xl shadow-lg ring-1 ring-white/40">
              <LogoMark className="h-11 w-11" />
            </span>
            <span className="leading-tight">
              <span className="block text-xl font-bold tracking-tight">MathVision</span>
              <span className="block text-[11px] font-bold uppercase tracking-[0.25em] text-[#bcc3ff]">
                Inventory
              </span>
            </span>
          </span>
        </div>

        <div className="relative z-10 px-10">
          <p className="text-xs font-bold uppercase tracking-[0.3em] text-[#bcc3ff]">
            Supplies for the campus team
          </p>
          <div className="mt-3 h-0.5 w-24 bg-[#bcc3ff]" />

          <ul className="mt-10 space-y-8">
            {STEPS.map((step) => (
              <li key={step.n} className="flex items-center gap-5">
                <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#2E3192] font-serif text-xl text-white shadow-md">
                  {step.n}
                </span>
                <span className="font-serif text-3xl xl:text-4xl">{step.text}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Ordering / delivery line art (carton + packing checklist) */}
        <div className="relative z-10 flex items-end justify-between p-10">
          <p className="text-sm text-white/70">
            MathVision · Inventory — Level 8 &amp; Basement store rooms
          </p>
          <DeliveryArt className="-mb-6 -mr-2 h-44 w-auto shrink-0 text-white/30 xl:h-56" />
        </div>
      </aside>

      {/* ── Sign-in panel ── */}
      <section className="brand-grid-light relative flex w-full items-center justify-center bg-[#f7f7f9] px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          {/* Compact brand header on small screens (the panel is hidden) */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <LogoMark className="h-10 w-10" />
            <span className="leading-tight">
              <span className="block font-bold tracking-tight">MathVision</span>
              <span className="block text-[10px] font-bold uppercase tracking-[0.25em] text-primary">
                Inventory
              </span>
            </span>
          </div>

          <h1 className="font-serif text-4xl font-medium tracking-tight">Sign in</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Sign in with the account created for you.
          </p>

          <LoginForm />

          <p className="mt-8 text-sm text-muted-foreground">
            Forgot your password?{" "}
            <a
              href="mailto:procurement@mathvision.com.sg?subject=Password%20reset%20request%20%E2%80%94%20MathVision%20Inventory&body=Hi%20Procurement%2C%0A%0APlease%20reset%20my%20MathVision%20Inventory%20password.%0A%0AMy%20login%20email%3A%20%0AMy%20User%20ID%3A%20%0A%0AThanks!"
              className="font-medium text-primary underline-offset-2 hover:underline"
            >
              Request a new one
            </a>{" "}
            — the procurement team will send you a temporary password.
          </p>
        </div>
      </section>
    </main>
  );
}

/** Line-art in the style of the invoice login's calendar/receipt outlines —
 * an open carton and a packing checklist. Stroke-only, inherits opacity
 * from the parent's text color. */
function DeliveryArt({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 300 220"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* open carton */}
      <rect x="18" y="92" width="150" height="112" rx="6" />
      {/* open flaps */}
      <path d="M18 92 L2 66" />
      <path d="M168 92 L184 66" />
      {/* tape */}
      <path d="M93 92 v112" strokeDasharray="10 8" />
      {/* closed box behind */}
      <path d="M44 92 v-32 a6 6 0 0 1 6 -6 h86 a6 6 0 0 1 6 6 v32" />
      <path d="M93 54 v38" strokeDasharray="8 7" />
      {/* packing checklist */}
      <g transform="translate(196 46)">
        <rect x="0" y="0" width="86" height="150" rx="10" />
        <rect x="26" y="-8" width="34" height="16" rx="6" />
        <circle cx="18" cy="38" r="6" />
        <path d="M15 38 l2.5 3 l4.5 -6" strokeWidth="2.5" />
        <path d="M34 38 h34" />
        <circle cx="18" cy="70" r="6" />
        <path d="M15 70 l2.5 3 l4.5 -6" strokeWidth="2.5" />
        <path d="M34 70 h34" />
        <circle cx="18" cy="102" r="6" />
        <path d="M34 102 h26" />
        <path d="M12 128 h48" />
      </g>
    </svg>
  );
}
