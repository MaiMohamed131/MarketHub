import { useState } from "react";
import { Link } from "react-router-dom";
import { useProducts } from "./api";

export function HomeDealAlert() {
  const deals = useProducts("deals=true&inStock=true&limit=48");
  const [dismissed, setDismissed] = useState(() => {
    try {
      return (
        sessionStorage.getItem("markethub.deal-alert.dismissed") === "true"
      );
    } catch {
      return false;
    }
  });
  const toggle = (value: boolean) => {
    setDismissed(value);
    try {
      sessionStorage.setItem("markethub.deal-alert.dismissed", String(value));
    } catch {
      /* Dismissal still works when browser storage is unavailable. */
    }
  };
  const products = deals.data?.products || [];
  const discount = products.reduce(
    (max, p) =>
      Math.max(
        max,
        p.originalPrice && p.originalPrice > p.price
          ? Math.round((1 - p.price / p.originalPrice) * 100)
          : 0,
      ),
    0,
  );
  if (dismissed)
    return (
      <div className="home-alert-restore">
        <button className="text-button" onClick={() => toggle(false)}>
          ✦ Show shopping offers
        </button>
      </div>
    );
  return (
    <aside className="home-deal-alert" aria-label="Shopping offers">
      <span className="deal-alert-icon" aria-hidden="true">
        <svg width="25" height="29" viewBox="0 0 24 28" fill="currentColor">
          <path d="M14 1 2 16h8L8 27l14-16h-9L14 1Z" />
        </svg>
      </span>
      <div className="deal-alert-copy">
        <span className="deal-alert-label">
          {products.length ? "DEAL ALERT" : "THE MARKETPLACE EDIT"}
        </span>
        <h2>
          {products.length
            ? "Great finds. Even better prices."
            : "A little more to discover."}
        </h2>
        <p>
          {products.length
            ? `${deals.data!.pagination.total} in-stock offers to explore${discount ? ` · Save up to ${discount}% on selected finds` : ""}`
            : "Discover new arrivals, everyday favorites, and thoughtful prices."}
        </p>
      </div>
      {products.length > 0 && discount > 0 && (
        <div className="deal-alert-saving">
          <strong>{discount}%</strong>
          <span>UP TO · SELECTED FINDS</span>
        </div>
      )}
      <Link
        className="deal-alert-link"
        to={products.length ? "/products?deals=true&inStock=true" : "/products"}
      >
        {products.length ? "Shop the deals" : "Explore products"}{" "}
        <span aria-hidden="true">→</span>
      </Link>
      <button
        className="deal-alert-dismiss"
        aria-label="Dismiss shopping offer"
        onClick={() => toggle(true)}
      >
        ×
      </button>
    </aside>
  );
}

export function HomeShoppingAlerts() {
  return (
    <div className="home-shopping-alerts" aria-label="Marketplace highlights">
      <Link to="/products?sort=newest" className="shopping-alert-card">
        <span className="shopping-alert-symbol" aria-hidden="true">
          ✦
        </span>
        <div>
          <span className="eyebrow">JUST LANDED</span>
          <h3>Fresh finds have arrived.</h3>
          <p>Discover the latest additions to the marketplace.</p>
        </div>
        <span className="shopping-alert-arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
      <Link to="/help" className="shopping-alert-card">
        <span className="shopping-alert-symbol" aria-hidden="true">
          ♧
        </span>
        <div>
          <span className="eyebrow">A LITTLE EXTRA, ON US</span>
          <h3>Your delivery could be free.</h3>
          <p>Free US shipping on orders of $100 or more per store.</p>
        </div>
        <span className="shopping-alert-arrow" aria-hidden="true">
          ↗
        </span>
      </Link>
    </div>
  );
}
