import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: MarketingPage,
});

const pillars = [
  "A focused coding surface that keeps plans, edits, and verification in one flow.",
  "Opinionated orchestration for product teams that want fewer panels and sharper defaults.",
  "Local-first desktop ergonomics with the room to grow into durable backend concepts.",
];

function MarketingPage() {
  return (
    <main className="page-shell">
      <nav className="nav" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="Honk home">
          Honk
        </a>
        <div className="nav-links">
          <a href="#product">Product</a>
          <a href="#principles">Principles</a>
          <a className="nav-cta" href="https://usehonk.com">
            Get Honk
          </a>
        </div>
      </nav>

      <section className="hero" id="product">
        <p className="eyebrow">AI coding workspace</p>
        <h1>Ship product work without losing the thread.</h1>
        <p className="hero-copy">
          Honk brings planning, implementation, and review into a single durable workspace for
          developers who want the assistant to feel fast, direct, and under control.
        </p>
        <div className="hero-actions">
          <a className="primary-action" href="https://usehonk.com">
            Start using Honk
          </a>
          <a className="secondary-action" href="#principles">
            Read the principles
          </a>
        </div>
      </section>

      <section className="principles" id="principles" aria-labelledby="principles-title">
        <div>
          <p className="eyebrow">Principles</p>
          <h2 id="principles-title">Built for focused momentum.</h2>
        </div>
        <div className="cards">
          {pillars.map((pillar, index) => (
            <article className="card" key={pillar}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <p>{pillar}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
