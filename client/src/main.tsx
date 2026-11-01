import axios from "axios";
import { HomeDealAlert, HomeShoppingAlerts } from "./home-alerts";
import { AuthPage, AccountPage } from "./account";
import { ProductReviews, ReviewPurchase, NotificationsPage } from "./community";
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Link,
  NavLink,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider, useDispatch, useSelector } from "react-redux";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { store, toggleMenu, closeMenu, type RootState } from "./store";
import {
  useCategories,
  useProducts,
  useProduct,
  money,
  type Product,
} from "./api";
import "./styles.css";
import "./storefront.css";
import {
  AdminDashboard,
  AdminList,
  AdminRecord,
  AdminCategories,
  AdminOrder,
} from "./admin";
import {
  SellerApplicationPage,
  SellerDashboard,
  SellerWorkspaceLayout,
  SellerProducts,
  SellerProductEditor,
  SellerOrders,
} from "./seller";
import {
  CartPage,
  WishlistPage,
  CheckoutPage,
  OrdersPage,
  OrderPage,
  PurchaseButtons,
  useCart,
} from "./commerce";
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 60000, retry: 1, refetchOnWindowFocus: false },
  },
});
function Icon({
  kind,
}: {
  kind: "bag" | "cart" | "user" | "heart" | "search";
}) {
  const paths = {
    bag: (
      <>
        <path d="M5 7h14l2 14H3L5 7Z" />
        <path d="M8 8V6a4 4 0 0 1 8 0v2" />
        <path d="m8 13 3 3 5-5" />
      </>
    ),
    cart: (
      <>
        <path d="M2 3h3l3 13h11l3-10H6" />
        <circle cx="9" cy="21" r="1" />
        <circle cx="19" cy="21" r="1" />
      </>
    ),
    user: (
      <>
        <circle cx="12" cy="7" r="4" />
        <path d="M3 22v-3a9 9 0 0 1 18 0v3H3Z" />
      </>
    ),
    heart: (
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    ),
    search: (
      <>
        <circle cx="10" cy="10" r="7" />
        <path d="m15 15 6 6" />
      </>
    ),
  };
  return (
    <svg
      className="ui-icon"
      width="25"
      height="25"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[kind]}
    </svg>
  );
}
function Header() {
  const dispatch = useDispatch();
  const open = useSelector((s: RootState) => s.ui.menuOpen);
  const categories = useCategories();
  const cart = useCart();
  const count = cart.data?.items.reduce((n, item) => n + item.quantity, 0) || 0;
  return (
    <>
      <div className="announcement">
        <span>♧ &nbsp; Free shipping on orders over $100 per store</span>
        <div>
          <Link to="/orders">Track Order</Link>
          <Link to="/help">Help</Link>
          <Link to="/contact">Contact</Link>
        </div>
      </div>
      <header>
        <Link to="/" className="logo">
          <img
            className="brand-logo-image"
            src="/brand/markethub-mark.svg"
            alt=""
            width="42"
            height="42"
          />
          Market<span>Hub</span>
        </Link>
        <form action="/products" className="search">
          <input
            aria-label="Search products"
            name="q"
            placeholder="Search for products, brands & more…"
          />
          <button aria-label="Submit search">
            <Icon kind="search" />
          </button>
        </form>
        <div className="header-actions">
          <Link to="/account" aria-label="My account">
            <Icon kind="user" />
          </Link>
          <Link to="/wishlist" aria-label="Wishlist">
            <Icon kind="heart" />
          </Link>
          <Link
            className="cart-link"
            to="/cart"
            aria-label={"Shopping cart, " + count + " items"}
          >
            <Icon kind="cart" />
            <b>{count}</b>
          </Link>
        </div>
        <button
          className="menu-button"
          aria-label="Toggle navigation"
          aria-expanded={open}
          onClick={() => dispatch(toggleMenu())}
        >
          ☰
        </button>
      </header>
      <nav className={open ? "nav open" : "nav"}>
        <NavLink to="/" end onClick={() => dispatch(closeMenu())}>
          Home
        </NavLink>
        <NavLink to="/products" onClick={() => dispatch(closeMenu())}>
          Shop
        </NavLink>
        <details className="category-menu">
          <summary>Categories ⌄</summary>
          <div>
            {categories.data?.map((c) => (
              <Link
                key={c._id}
                to={"/products?category=" + c._id}
                onClick={(e) => {
                  e.currentTarget.closest("details")?.removeAttribute("open");
                  dispatch(closeMenu());
                }}
              >
                {c.name}
              </Link>
            ))}
            {!categories.data?.length && (
              <Link to="/products">Explore all products</Link>
            )}
          </div>
        </details>
        <Link to="/products?deals=true">Today's Deals</Link>
        <Link to="/about">About</Link>
        <Link to="/contact">Contact</Link>
        <span>Everyday essentials. Extraordinary finds.</span>
      </nav>
    </>
  );
}
function ErrorState({
  retry,
  detail = false,
}: {
  retry: () => unknown;
  detail?: boolean;
}) {
  return (
    <div className="state" role="alert">
      <span className="state-icon">↻</span>
      <h2>
        {detail
          ? "We couldn’t load this product"
          : "The marketplace is taking a moment"}
      </h2>
      <p>We couldn’t reach the catalog. Please try again shortly.</p>
      <button className="primary" onClick={() => void retry()}>
        Try again
      </button>
    </div>
  );
}
function Skeleton() {
  return (
    <div
      className="product-grid"
      aria-label="Loading products"
      aria-busy="true"
    >
      {Array.from({ length: 4 }, (_, i) => (
        <div className="skeleton" key={i}>
          <div />
          <p />
          <p />
        </div>
      ))}
    </div>
  );
}
function ProductImage({ src, name }: { src?: string; name: string }) {
  const [failed, setFailed] = useState(false);
  return src && !failed ? (
    <img src={src} alt={name} loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <div className="image-placeholder" aria-label="Product image unavailable">
      ◇<small>Image unavailable</small>
    </div>
  );
}
function Card({ product: p }: { product: Product }) {
  const discount =
    p.originalPrice && p.originalPrice > p.price
      ? Math.round((1 - p.price / p.originalPrice) * 100)
      : 0;
  return (
    <article className="product-card">
      <Link className="card-image" to={"/products/" + p._id}>
        <ProductImage src={p.images[0]} name={p.name} />
        {discount > 0 && <span className="discount-tag">−{discount}%</span>}
        {p.stock === 0 && <span className="stock-tag">Sold out</span>}
      </Link>
      <div className="card-copy">
        <p className="store-name">{p.brand || p.storeName}</p>
        <Link to={"/products/" + p._id}>
          <h3>{p.name}</h3>
        </Link>
        <div className="card-bottom">
          <strong>{money(p.price)}</strong>
          {discount > 0 && <del>{money(p.originalPrice!)}</del>}
        </div>
        <p className="card-rating">
          {p.reviewCount > 0
            ? "★ " +
              p.averageRating.toFixed(1) +
              " (" +
              p.reviewCount +
              " reviews)"
            : "New arrival · No reviews yet"}
        </p>
        <small className="availability">
          {p.stock ? "● In stock" : "Currently unavailable"}
          {p.demoKey ? " · Demo product" : ""}
        </small>
        <PurchaseButtons product={p} compact />
      </div>
    </article>
  );
}
function Categories() {
  const c = useCategories();
  if (c.isError)
    return (
      <p className="muted">
        Categories are temporarily unavailable.{" "}
        <button className="text-button" onClick={() => void c.refetch()}>
          Retry
        </button>
      </p>
    );
  if (c.isPending)
    return (
      <p className="muted" aria-busy>
        Loading categories…
      </p>
    );
  return c.data.length ? (
    <div className="category-grid">
      {c.data.map((cat, i) => (
        <Link to={"/products?category=" + cat._id} key={cat._id}>
          <span className={"category-symbol tone-" + (i % 4)}>
            {(
              {
                electronics: "⌨",
                "mobile-phones": "▯",
                "computers-laptops": "⌨",
                "fashion-clothing": "♧",
                "shoes-bags": "♧",
                "home-living": "⌂",
                "kitchen-appliances": "♨",
                "beauty-personal-care": "✿",
                "sports-fitness": "⚽",
                "toys-games": "♜",
                "books-stationery": "▤",
                "automotive-accessories": "⚙",
              } as Record<string, string>
            )[cat.slug] || "◇"}
          </span>
          <div>
            <h3>{cat.name}</h3>
            <p>{cat.description || "Explore the collection"}</p>
          </div>
          <b>↗</b>
        </Link>
      ))}
    </div>
  ) : (
    <p className="muted">New collections are on their way.</p>
  );
}
function Collection({
  title,
  subtitle,
  params,
}: {
  title: string;
  subtitle: string;
  params: string;
}) {
  const result = useProducts(params + "&limit=4");
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{subtitle}</p>
          <h2>{title}</h2>
        </div>
        <Link to={"/products?" + params}>
          View collection <span>↗</span>
        </Link>
      </div>
      {result.isPending ? (
        <Skeleton />
      ) : result.isError ? (
        <ErrorState retry={result.refetch} />
      ) : result.data.products.length ? (
        <div className="product-grid">
          {result.data.products.map((p) => (
            <Card key={p._id} product={p} />
          ))}
        </div>
      ) : (
        <div className="empty-small">
          This collection is waiting for its first finds. Check back soon.
        </div>
      )}
    </section>
  );
}
function Home() {
  return (
    <>
      <HomeDealAlert />
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">
            Smart shopping. Better living. <span>━━━━</span>
          </p>
          <h1>
            Discover Amazing
            <br />
            Deals at <em>MarketHub</em>
          </h1>
          <p>
            Your everyday favorites. Your next great find.
            <br />
            Shop a world of possibilities, all in one place.
          </p>
          <div className="hero-actions">
            <Link className="primary" to="/products">
              Shop Now <span>→</span>
            </Link>
            <Link to="/products?deals=true">Explore the deals ↗</Link>
          </div>
          <div className="hero-note">
            <span>✦</span> Big on choice. Thoughtful on price.
          </div>
        </div>
        <div className="market-hero-art">
          <img
            src="https://images.unsplash.com/photo-1546435770-a3e426bf472b?auto=format&fit=crop&w=1000&q=85"
            alt="Premium wireless headphones"
            fetchPriority="high"
          />
          <div className="hero-sticker">
            <span>THE EVERYDAY UPGRADE</span>
            <strong>
              Sound good.
              <br />
              Feel even better.
            </strong>
            <Link to="/products?q=headphones">Discover audio →</Link>
          </div>
        </div>
      </section>
      <HomeShoppingAlerts />
      <section className="section category-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">A little something for everyone</p>
            <h2>Shop by category</h2>
          </div>
          <Link to="/products">Explore all →</Link>
        </div>
        <Categories />
      </section>
      <Collection
        title="Featured Products"
        subtitle="Selected for your everyday"
        params="featured=true"
      />
      <section className="promo-grid">
        <Link className="promo promo-dark" to="/products?deals=true">
          <p className="eyebrow">Good finds. Better prices.</p>
          <h2>
            More to love.
            <br />
            <em>Less to spend.</em>
          </h2>
          <p>Discover offers across the marketplace.</p>
          <span className="primary">Shop the deals →</span>
          <span className="promo-decoration" aria-hidden>
            ✳
          </span>
        </Link>
        <Link className="promo promo-light" to="/products?sort=newest">
          <p className="eyebrow">Make room for something new</p>
          <h2>
            Better finds.
            <br />
            Happier you.
          </h2>
          <p>A fresh edit for the way you live.</p>
          <span className="primary">Explore new arrivals →</span>
          <span className="promo-decoration" aria-hidden>
            ✦
          </span>
        </Link>
      </section>
      <Collection
        title="Best Sellers"
        subtitle="Discover the crowd favorites"
        params="sort=popular"
      />
      <Collection
        title="Today's Deals"
        subtitle="A little more for a little less"
        params="deals=true"
      />
      <Collection
        title="New Arrivals"
        subtitle="Fresh finds, endless possibilities"
        params="sort=newest"
      />
      <Collection
        title="Recommended for You"
        subtitle="More favorites to discover"
        params="sort=rating"
      />
      <Collection
        title="Trending Now"
        subtitle="See what everyone is discovering"
        params="sort=popular&page=2"
      />
      <div className="benefits">
        <div>
          <b>♧</b>
          <span>
            <strong>Free shipping</strong>
            <small>On orders over $100 per store</small>
          </span>
        </div>
        <div>
          <b>◇</b>
          <span>
            <strong>Shop with confidence</strong>
            <small>Pay securely on delivery</small>
          </span>
        </div>
        <div>
          <b>☏</b>
          <span>
            <strong>Here to help</strong>
            <small>Visit our customer support center</small>
          </span>
        </div>
        <div>
          <b>↻</b>
          <span>
            <strong>Thoughtful service</strong>
            <small>Help with every order</small>
          </span>
        </div>
      </div>
    </>
  );
}
const filterSchema = z
  .object({
    q: z.string().max(100),
    minPrice: z
      .string()
      .refine(
        (v) => v === "" || /^\d{1,7}(\.\d{1,2})?$/.test(v),
        "Enter a valid price",
      ),
    maxPrice: z
      .string()
      .refine(
        (v) => v === "" || /^\d{1,7}(\.\d{1,2})?$/.test(v),
        "Enter a valid price",
      ),
    category: z.string(),
    brand: z.string().max(80),
    minRating: z.string(),
    inStock: z.string(),
  })
  .refine(
    (v) =>
      !v.minPrice || !v.maxPrice || Number(v.minPrice) <= Number(v.maxPrice),
    { path: ["maxPrice"], message: "Maximum must be at least the minimum" },
  );
function Filters({
  params,
  onApply,
}: {
  params: URLSearchParams;
  onApply: (v: z.infer<typeof filterSchema>) => void;
}) {
  const categories = useCategories();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(filterSchema),
    defaultValues: {
      brand: params.get("brand") || "",
      minRating: params.get("minRating") || "",
      inStock: params.get("inStock") || "",
      q: params.get("q") || "",
      category: params.get("category") || "",
      minPrice: params.get("minPrice") || "",
      maxPrice: params.get("maxPrice") || "",
    },
  });
  return (
    <form className="filters" onSubmit={handleSubmit(onApply)}>
      <h2>Refine your finds</h2>
      <label>
        Search
        <input {...register("q")} placeholder="Name or description" />
      </label>
      {errors.q && <small role="alert">{errors.q.message}</small>}
      <label>
        Category
        <select {...register("category")}>
          <option value="">All categories</option>
          {categories.data?.map((c) => (
            <option value={c._id} key={c._id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      {categories.isError && (
        <button
          type="button"
          className="text-button"
          onClick={() => void categories.refetch()}
        >
          Retry loading categories
        </button>
      )}
      <fieldset>
        <legend>Price range (USD)</legend>
        <div className="price-fields">
          <label>
            Min
            <input
              {...register("minPrice")}
              inputMode="decimal"
              placeholder="0.00"
            />
          </label>
          <span>—</span>
          <label>
            Max
            <input
              {...register("maxPrice")}
              inputMode="decimal"
              placeholder="Any"
            />
          </label>
        </div>
      </fieldset>
      {(errors.minPrice || errors.maxPrice) && (
        <small role="alert">
          {errors.minPrice?.message || errors.maxPrice?.message}
        </small>
      )}
      <label>
        Brand
        <input
          {...register("brand")}
          placeholder="e.g. Anker, Lenovo, MarketHub"
        />
      </label>
      <label>
        Customer rating
        <select {...register("minRating")}>
          <option value="">All ratings</option>
          <option value="4">4 stars & up</option>
          <option value="3">3 stars & up</option>
        </select>
      </label>
      <label>
        Availability
        <select {...register("inStock")}>
          <option value="">All products</option>
          <option value="true">In stock</option>
          <option value="false">Out of stock</option>
        </select>
      </label>
      <button className="primary">Apply filters ↗</button>
      <Link to="/products" className="reset">
        Clear all filters
      </Link>
      <div className="filter-note">
        ✦
        <p>
          A little browsing.
          <br />A great discovery.
        </p>
      </div>
    </form>
  );
}
function Catalog() {
  const [params, setParams] = useSearchParams();
  const products = useProducts(params.toString());
  const change = (key: string, value: string) => {
    const n = new URLSearchParams(params);
    n.set(key, value);
    if (key !== "page") n.delete("page");
    setParams(n);
  };
  return (
    <>
      <div className="catalog-title">
        <p className="eyebrow">Your next favorite is here</p>
        <h1>The marketplace.</h1>
        <p>
          Everything you need. A little more to discover. Shop all your
          favorites in one place.
        </p>
      </div>
      <div className="catalog-layout">
        <Filters
          key={params.toString()}
          params={params}
          onApply={(v) => {
            const n = new URLSearchParams(params);
            Object.entries(v).forEach(([k, value]) =>
              value ? n.set(k, value) : n.delete(k),
            );
            n.delete("page");
            setParams(n);
          }}
        />
        <section>
          <div className="results-toolbar">
            <span aria-live="polite">
              {products.data
                ? `${products.data.pagination.total} finds to explore`
                : "Explore the collection"}
            </span>
            <label>
              Sort by{" "}
              <select
                value={params.get("sort") || "newest"}
                onChange={(e) => change("sort", e.target.value)}
              >
                <option value="newest">Newest arrivals</option>
                <option value="popular">Most popular</option>
                <option value="rating">Highest rated</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
              </select>
            </label>
          </div>
          {products.isPending ? (
            <Skeleton />
          ) : products.isError ? (
            <ErrorState retry={products.refetch} />
          ) : products.data.products.length ? (
            <>
              <div className="product-grid catalog-grid">
                {products.data.products.map((p) => (
                  <Card key={p._id} product={p} />
                ))}
              </div>
              <div className="pagination">
                <button
                  disabled={products.data.pagination.page <= 1}
                  onClick={() =>
                    change("page", String(products.data.pagination.page - 1))
                  }
                >
                  ← Previous
                </button>
                <span>
                  Page {products.data.pagination.page} of{" "}
                  {products.data.pagination.pages}
                </span>
                <button
                  disabled={
                    products.data.pagination.page >=
                    products.data.pagination.pages
                  }
                  onClick={() =>
                    change("page", String(products.data.pagination.page + 1))
                  }
                >
                  Next →
                </button>
              </div>
            </>
          ) : (
            <div className="state">
              <h2>No finds this time.</h2>
              <p>Try a different search or a wider price range.</p>
              <Link className="primary" to="/products">
                Clear filters
              </Link>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
function Detail() {
  const { id = "" } = useParams();
  const result = useProduct(id);
  const [selected, setSelected] = useState(0);
  useEffect(() => setSelected(0), [id]);
  if (result.isPending)
    return (
      <section className="section">
        <Skeleton />
      </section>
    );
  if (
    result.isError &&
    axios.isAxiosError(result.error) &&
    result.error.response?.status === 404
  )
    return (
      <section className="section state">
        <h1>This product is unavailable.</h1>
        <p>The listing may have been removed or deactivated.</p>
        <Link className="primary" to="/products">
          Browse the marketplace ↗
        </Link>
      </section>
    );
  if (result.isError) return <ErrorState detail retry={result.refetch} />;
  const { product: p, related } = result.data;
  return (
    <section className="section">
      <div className="breadcrumbs">
        <Link to="/products">Marketplace</Link>
        <span>/</span>
        {typeof p.category !== "string" && (
          <Link to={"/products?category=" + p.category._id}>
            {p.category.name}
          </Link>
        )}
        <span>/</span>
        <span>{p.name}</span>
      </div>
      <div className="detail-grid">
        <div>
          <div className="detail-image">
            <ProductImage src={p.images[selected]} name={p.name} />
          </div>
          {p.images.length > 1 && (
            <div className="thumbnails">
              {p.images.map((src, i) => (
                <button
                  key={src + i}
                  aria-label={"View image " + (i + 1)}
                  aria-pressed={selected === i}
                  onClick={() => setSelected(i)}
                >
                  <ProductImage src={src} name={p.name + " view " + (i + 1)} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="detail-copy">
          <p className="eyebrow">An independent find</p>
          <p className="store-name">From {p.storeName}</p>
          <h1>{p.name}</h1>
          <p className="rating">
            {p.reviewCount
              ? `★ ${p.averageRating.toFixed(1)} · ${p.reviewCount} ${p.reviewCount === 1 ? "review" : "reviews"}`
              : "No ratings yet"}
          </p>
          <strong className="detail-price">{money(p.price)}</strong>
          {p.originalPrice && p.originalPrice > p.price && (
            <p>
              <del>{money(p.originalPrice)}</del>{" "}
              <b className="deal-text">
                Save {Math.round((1 - p.price / p.originalPrice) * 100)}%
              </b>
            </p>
          )}
          {p.demoKey && (
            <p className="demo-note">
              Demonstration product · Sample catalog data
            </p>
          )}
          <p className={p.stock ? "in-stock" : "out-stock"}>
            {p.stock
              ? `● In stock · ${p.stock} available`
              : "● Currently sold out"}
          </p>
          <div className="description">
            <h2>The details</h2>
            <p>{p.description}</p>
          </div>
          <div className="seller-box">
            <b>◈</b>
            <div>
              <small>Sold by an independent store</small>
              <h3>{p.storeName}</h3>
            </div>
          </div>
          {p.specifications && (
            <dl className="specifications">
              {Object.entries(p.specifications).map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
          )}
          <PurchaseButtons product={p} />
          <div className="delivery-note">
            <strong>Delivery, made simple.</strong>
            <p>
              US delivery · $5 per store. Free shipping on orders over $100 per
              store. Pay on delivery. Track your purchase in My Orders.
            </p>
            <Link to="/help">Shipping & returns information →</Link>
          </div>
        </div>
      </div>
      <div className="section-heading related-heading">
        <div>
          <p className="eyebrow">Keep discovering</p>
          <h2>You might also love.</h2>
        </div>
      </div>
      {related.length ? (
        <div className="product-grid">
          {related.map((product) => (
            <Card key={product._id} product={product} />
          ))}
        </div>
      ) : (
        <p className="muted">More from this collection coming soon.</p>
      )}
      <ProductReviews id={p._id} />
    </section>
  );
}
function InfoPage({ kind }: { kind: string }) {
  return (
    <section className="section info-page">
      <p className="eyebrow">The MarketHub experience</p>
      <h1>
        {kind === "about"
          ? "A world of great finds."
          : kind === "contact"
            ? "Let’s talk."
            : "How can we help?"}
      </h1>
      {kind === "about" ? (
        <>
          <p>
            MarketHub brings independent stores and everyday shopping together.
            Discover technology, fashion, home essentials, and more through one
            marketplace.
          </p>
          <Link className="primary" to="/products">
            Explore the marketplace →
          </Link>
        </>
      ) : (
        <>
          <h2>Orders & delivery</h2>
          <p>
            Visit My Orders to track each store’s fulfillment status. Delivery
            is currently available in the United States. Shipping is $5 per
            store, with free shipping on orders of $100 or more from each store.
          </p>
          <h2>Payment & returns</h2>
          <p>
            Pay on delivery. You can cancel eligible orders before shipping from
            the order details page. For returns or product questions, contact
            the selling store using the details supplied with your order.
          </p>
          <Link className="primary" to="/orders">
            Manage my orders →
          </Link>
          <p>
            For account assistance, visit{" "}
            <Link to="/account">your account</Link>. Seller contact details are
            included with your order correspondence.
          </p>
        </>
      )}
    </section>
  );
}
function Footer() {
  return (
    <footer>
      <div>
        <Link to="/" className="logo">
          <img
            className="brand-logo-image"
            src="/brand/markethub-mark.svg"
            alt=""
            width="42"
            height="42"
          />
          Market<span>Hub</span>
        </Link>
        <p>
          Smart shopping. Better living.
          <br />A world of possibilities, all in one place.
        </p>
      </div>
      <div>
        <h3>Discover MarketHub</h3>
        <Link to="/products">Shop all products</Link>
        <Link to="/products?deals=true">Today's deals</Link>
        <Link to="/products?sort=newest">New arrivals</Link>
        <Link to="/about">About us</Link>
      </div>
      <div>
        <h3>Here to help</h3>
        <Link to="/help">Shipping & returns</Link>
        <Link to="/orders">Track your order</Link>
        <Link to="/contact">Contact & support</Link>
        <Link to="/account">My account</Link>
      </div>
      <div>
        <h3>Grow with us</h3>
        <Link className="footer-seller-sign-in" to="/seller/sign-in">
          Seller Sign In →
        </Link>
        <Link to="/seller/application">Become a seller</Link>
        <Link to="/seller">Seller workspace</Link>
        <Link to="/admin">Administration</Link>
        <Link to="/notifications">Notifications</Link>
        <p>Payment: Cash on delivery</p>
      </div>
      <div className="footer-bottom">
        <span>
          © {new Date().getFullYear()} MarketHub. All rights reserved.
        </span>
        <span>Thoughtful finds. Everyday possibilities.</span>
      </div>
    </footer>
  );
}
function App() {
  return (
    <>
      <Header />
      <main>
        <Routes>
          <Route path="/about" element={<InfoPage kind="about" />} />
          <Route path="/contact" element={<InfoPage kind="contact" />} />
          <Route path="/help" element={<InfoPage kind="help" />} />
          <Route path="/account" element={<AccountPage />} />
          <Route
            path="/register"
            element={<AuthPage key="register" mode="register" />}
          />
          <Route
            path="/forgot-password"
            element={<AuthPage key="forgot" mode="forgot" />}
          />
          <Route
            path="/request-verification"
            element={<AuthPage key="request" mode="request-verification" />}
          />
          <Route
            path="/verify-email"
            element={<AuthPage key="verify" mode="verify" />}
          />
          <Route
            path="/reset-password"
            element={<AuthPage key="reset" mode="reset" />}
          />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route
            path="/orders/:orderId/review/:productId"
            element={<ReviewPurchase />}
          />
          <Route
            path="/admin/sign-in"
            element={<AuthPage key="admin-login" mode="login" administrator />}
          />
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/users" element={<AdminList kind="users" />} />
          <Route
            path="/admin/users/:id"
            element={<AdminRecord kind="users" />}
          />
          <Route path="/admin/sellers" element={<AdminList kind="sellers" />} />
          <Route
            path="/admin/products"
            element={<AdminList kind="products" />}
          />
          <Route
            path="/admin/products/:id"
            element={<AdminRecord kind="products" />}
          />
          <Route path="/admin/categories" element={<AdminCategories />} />
          <Route path="/admin/orders" element={<AdminList kind="orders" />} />
          <Route path="/admin/orders/:id" element={<AdminOrder />} />
          <Route
            path="/seller/sign-in"
            element={<AuthPage key="seller-login" mode="login" seller />}
          />
          <Route path="/seller" element={<SellerWorkspaceLayout />}>
            <Route index element={<SellerDashboard />} />
            <Route path="application" element={<SellerApplicationPage />} />
            <Route path="products" element={<SellerProducts />} />
            <Route path="products/new" element={<SellerProductEditor />} />
            <Route path="products/:id" element={<SellerProductEditor />} />
            <Route path="orders" element={<SellerOrders />} />
          </Route>
          <Route
            path="/sign-in"
            element={<AuthPage key="login" mode="login" />}
          />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/wishlist" element={<WishlistPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/orders/:id" element={<OrderPage />} />
          <Route path="/" element={<Home />} />
          <Route path="/products" element={<Catalog />} />
          <Route path="/products/:id" element={<Detail />} />
          <Route
            path="*"
            element={
              <div className="state">
                <h1>Page not found</h1>
                <Link to="/">Back to the marketplace</Link>
              </div>
            }
          />
        </Routes>
      </main>
      <Footer />
    </>
  );
}
const appRoot =
  import.meta.hot?.data.root ?? createRoot(document.getElementById("root")!);
if (import.meta.hot) import.meta.hot.data.root = appRoot;
appRoot.render(
  <React.StrictMode>
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </Provider>
  </React.StrictMode>,
);
