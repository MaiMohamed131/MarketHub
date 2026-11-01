import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api, money, type Product } from "./api";
import {
  addGuestItem,
  guestItems,
  mergeGuestCart,
  setGuestQuantity,
  useGuestCartSnapshot,
} from "./guest-cart";
type Group = {
  _id: string;
  storeName: string;
  status: string;
  subtotal: number;
  shipping: number;
  items: {
    product: string;
    name: string;
    image: string;
    price: number;
    quantity: number;
  }[];
};
type Quote = {
  groups: Group[];
  subtotal: number;
  shipping: number;
  total: number;
};
type Cart = {
  guest?: boolean;
  revision: number;
  quote: Quote | null;
  items: {
    productId: string;
    quantity: number;
    available: boolean;
    product: Product | null;
  }[];
};
type Order = Quote & {
  _id: string;
  createdAt: string;
  paymentMethod: string;
  paymentStatus: string;
  cancelledAt?: string;
  address: {
    name: string;
    line1: string;
    city: string;
    postalCode: string;
    country: string;
  };
};
const message = (e: unknown) =>
  axios.isAxiosError(e)
    ? e.response?.data?.error || "Unable to connect. Please try again."
    : e instanceof Error
      ? e.message
      : "Something went wrong.";
function Feedback({ error }: { error: unknown }) {
  return error ? (
    <p className="commerce-error" role="alert">
      {message(error)}{" "}
      {axios.isAxiosError(error) && error.response?.status === 401 && (
        <Link to="/sign-in">Sign in to continue →</Link>
      )}
    </p>
  ) : null;
}
export function useCart() {
  const guestSnapshot = useGuestCartSnapshot();
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["cart", guestSnapshot],
    queryFn: async (): Promise<Cart> => {
      try {
        return { ...(await api.get<Cart>("/cart")).data, guest: false };
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 401)
          throw error;
        const items = await Promise.all(
          guestItems().map(async (item) => {
            try {
              const result = await qc.fetchQuery({
                queryKey: ["product", item.productId],
                staleTime: 60000,
                queryFn: async () =>
                  (
                    await api.get<{ product: Product }>(
                      "/products/" + item.productId,
                    )
                  ).data,
              });
              return {
                ...item,
                product: result.product,
                available: result.product.stock >= item.quantity,
              };
            } catch (e) {
              if (axios.isAxiosError(e) && e.response?.status === 404)
                return { ...item, product: null, available: false };
              throw e;
            }
          }),
        );
        return { guest: true, revision: 0, quote: null, items };
      }
    },
    retry: false,
    refetchOnMount: "always",
  });
}
function GuestMergeNotice() {
  useGuestCartSnapshot();
  const qc = useQueryClient();
  const count = guestItems().length;
  const merge = useMutation({
    mutationFn: mergeGuestCart,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });
  if (!count) return null;
  return (
    <div className="application-status" role="status">
      <h2>Review your guest selections</h2>
      <p>
        {count} guest{" "}
        {count === 1 ? "product still needs" : "products still need"} to be
        added to this account. Availability may have changed. You can retry or
        remove them below.
      </p>
      {guestItems().map((i) => (
        <div key={i.productId}>
          <Link to={"/products/" + i.productId}>View product</Link> · Quantity{" "}
          {i.quantity}{" "}
          <button
            className="text-button"
            onClick={() => setGuestQuantity(i.productId, 0)}
          >
            Remove guest item
          </button>
        </div>
      ))}
      <button
        className="secondary"
        disabled={merge.isPending}
        onClick={() => merge.mutate()}
      >
        {merge.isPending ? "Updating cart…" : "Retry adding guest items"}
      </button>
      <Feedback error={merge.error} />
    </div>
  );
}
function Totals({ quote }: { quote: Quote }) {
  return (
    <div className="totals">
      {(["subtotal", "shipping", "total"] as const).map((k) => (
        <div key={k}>
          <strong>{k.toUpperCase()}</strong>
          <strong>{money(quote[k])}</strong>
        </div>
      ))}
      <small>
        $5 shipping per store. Free shipping from each store on orders of $100
        or more. US delivery only. Cash on delivery.
      </small>
    </div>
  );
}
export function PurchaseButtons({
  product,
  compact = false,
}: {
  product: Product;
  compact?: boolean;
}) {
  const qc = useQueryClient();
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState("");
  const add = useMutation({
    mutationFn: async (action: string) => {
      if (action === "wish") {
        await api.put("/wishlist/" + product._id);
        return "Saved to your wishlist";
      }
      try {
        const cart = (await api.get<Cart>("/cart")).data;
        const current = cart.items.find((i) => i.productId === product._id);
        await api.put("/cart/items/" + product._id, {
          quantity: (current?.quantity || 0) + quantity,
          revision: cart.revision,
        });
      } catch (error) {
        if (!axios.isAxiosError(error) || error.response?.status !== 401)
          throw error;
        addGuestItem(product._id, quantity, product.stock);
      }
      return "Added to your cart";
    },
    onSuccess: (text) => {
      setNotice(text);
      void qc.invalidateQueries({ queryKey: ["cart"] });
      void qc.invalidateQueries({ queryKey: ["wishlist"] });
    },
  });
  return (
    <div className={compact ? "purchase-actions compact" : "purchase-actions"}>
      {!compact && (
        <label>
          Quantity{" "}
          <input
            type="number"
            min="1"
            max={Math.min(99, product.stock || 1)}
            value={quantity}
            onChange={(e) =>
              setQuantity(
                Math.max(
                  1,
                  Math.min(99, product.stock || 1, Number(e.target.value) || 1),
                ),
              )
            }
          />
        </label>
      )}
      <button
        className="primary"
        disabled={!product.stock || add.isPending}
        onClick={() => add.mutate("cart")}
      >
        {add.isPending
          ? "Adding…"
          : notice === "Added to your cart"
            ? "✓ Added to cart"
            : "Add to cart"}
      </button>
      <button
        className="secondary"
        aria-label="Save to wishlist"
        disabled={add.isPending}
        onClick={() => add.mutate("wish")}
      >
        {notice === "Saved to your wishlist"
          ? "♥ Saved"
          : compact
            ? "♡"
            : "♡ Save to wishlist"}
      </button>
      <p role="status">{notice}</p>
      <Feedback error={add.error} />
    </div>
  );
}
export function CartPage() {
  const cart = useCart();
  const qc = useQueryClient();
  const update = useMutation({
    mutationFn: async ({ id, qty }: { id: string; qty: number }) => {
      if (cart.data?.guest) {
        setGuestQuantity(id, qty);
        return;
      }
      if (qty === 0) await api.delete("/cart/items/" + id);
      else
        await api.put("/cart/items/" + id, {
          quantity: qty,
          revision: cart.data!.revision,
        });
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });
  return (
    <section className="section">
      <h1>Your shopping cart.</h1>
      {cart.data?.guest && (
        <p className="muted">
          You’re shopping as a guest. Your selections stay in this browser. Sign
          in or create an account when you’re ready to checkout.
        </p>
      )}
      {cart.data && !cart.data.guest && <GuestMergeNotice />}
      {cart.isPending ? (
        <p aria-busy>Loading your cart…</p>
      ) : cart.isError ? (
        <Feedback error={cart.error} />
      ) : (
        <>
          <Feedback error={update.error} />
          {!cart.data.items.length ? (
            <div className="state">
              <h2>Your cart is waiting for a discovery.</h2>
              <Link className="primary" to="/products">
                Explore products →
              </Link>
            </div>
          ) : (
            <div className="shopping-layout">
              <div>
                {cart.data.items.map((i) => (
                  <article className="cart-row" key={i.productId}>
                    <div>
                      <Link to={"/products/" + i.productId}>
                        <h3>{i.product?.name || "Unavailable product"}</h3>
                      </Link>
                      <p>{i.product?.storeName}</p>
                      <strong>
                        {i.product ? money(i.product.price) : "—"}
                      </strong>
                      {!i.available && (
                        <p className="commerce-error">
                          Unavailable or insufficient stock. Update or remove
                          this item.
                        </p>
                      )}
                    </div>
                    <label>
                      Quantity
                      <input
                        aria-label={"Quantity for " + i.product?.name}
                        type="number"
                        min="1"
                        max={Math.min(99, i.product?.stock || 99)}
                        value={i.quantity}
                        disabled={update.isPending}
                        onChange={(e) => {
                          const qty = Number(e.target.value);
                          if (Number.isInteger(qty) && qty >= 1 && qty <= 99)
                            update.mutate({ id: i.productId, qty });
                        }}
                      />
                    </label>
                    <button
                      className="text-button"
                      disabled={update.isPending}
                      onClick={() => update.mutate({ id: i.productId, qty: 0 })}
                    >
                      Remove
                    </button>
                  </article>
                ))}
              </div>
              <aside>
                {cart.data.guest ? (
                  <>
                    <div className="totals">
                      <div>
                        <strong>Item subtotal</strong>
                        <strong>
                          {money(
                            cart.data.items.reduce(
                              (total, i) =>
                                total + (i.product?.price || 0) * i.quantity,
                              0,
                            ),
                          )}
                        </strong>
                      </div>
                      <small>
                        Shipping and the final total are confirmed after
                        sign-in. Prices and availability are checked again at
                        checkout.
                      </small>
                    </div>
                    <Link className="primary" to="/checkout">
                      Proceed to checkout →
                    </Link>
                  </>
                ) : cart.data.quote ? (
                  <>
                    <Totals quote={cart.data.quote} />
                    <Link className="primary" to="/checkout">
                      Proceed to checkout →
                    </Link>
                  </>
                ) : (
                  <p>Resolve unavailable items before checking out.</p>
                )}
              </aside>
            </div>
          )}
        </>
      )}
    </section>
  );
}
export function WishlistPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ["wishlist"],
    queryFn: async () =>
      (await api.get<{ products: Product[] }>("/wishlist")).data,
    retry: false,
  });
  const action = useMutation({
    mutationFn: async ({ id, move }: { id: string; move: boolean }) => {
      if (move) await api.post("/wishlist/" + id + "/move");
      else await api.delete("/wishlist/" + id);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["wishlist"] });
      void qc.invalidateQueries({ queryKey: ["cart"] });
    },
  });
  return (
    <section className="section">
      <h1>Your wishlist.</h1>
      <Feedback error={list.error || action.error} />
      {list.isPending ? (
        <p>Loading wishlist…</p>
      ) : (
        <div className="product-grid">
          {list.data?.products.map((p) => (
            <article className="product-card" key={p._id}>
              <Link to={"/products/" + p._id}>
                <div className="card-image">
                  <img src={p.images[0]} alt={p.name} />
                </div>
                <h3>{p.name}</h3>
              </Link>
              <strong>{money(p.price)}</strong>
              <button
                className="primary"
                disabled={!p.stock || action.isPending}
                onClick={() => action.mutate({ id: p._id, move: true })}
              >
                Move to cart
              </button>
              <button
                className="text-button"
                disabled={action.isPending}
                onClick={() => action.mutate({ id: p._id, move: false })}
              >
                Remove
              </button>
            </article>
          ))}
        </div>
      )}
      {list.data?.products.length === 0 && (
        <div className="state">
          <h2>A place for your favorites.</h2>
          <Link to="/products">Discover products →</Link>
        </div>
      )}
    </section>
  );
}
export function CheckoutPage() {
  const cart = useCart();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [key] = useState(() => crypto.randomUUID());
  const submit = useMutation({
    mutationFn: async (form: HTMLFormElement) => {
      const address = Object.fromEntries(new FormData(form));
      const r = await api.post<{ order: Order }>(
        "/orders",
        {
          address,
          paymentMethod: "cod",
          revision: cart.data!.revision,
          expectedTotal: cart.data!.quote!.total,
        },
        { headers: { "Idempotency-Key": key } },
      );
      return r.data.order;
    },
    onSuccess: (o) => {
      void qc.invalidateQueries({ queryKey: ["cart"] });
      nav("/orders/" + o._id);
    },
    onError: () => {
      void cart.refetch();
    },
  });
  if (cart.data?.guest)
    return (
      <div className="auth-page-shell">
        <section className="section narrow auth-page checkout-sign-in">
          <p className="eyebrow">Your MarketHub checkout</p>
          <h1>Sign in to checkout.</h1>
          <p className="muted">
            Your guest cart is saved. Sign in or create an account to transfer
            your selections and confirm delivery, stock, and the final total.
          </p>
          <div className="checkout-sign-in-actions">
            <Link className="primary" to="/sign-in?next=%2Fcheckout">
              Sign in to checkout →
            </Link>
            <Link className="secondary" to="/register?next=%2Fcheckout">
              Create an account
            </Link>
          </div>
          <div className="account-links">
            <Link to="/cart">← Return to your cart</Link>
          </div>
        </section>
      </div>
    );
  return (
    <section className="section">
      <h1>Checkout.</h1>
      {cart.data && !cart.data.guest && <GuestMergeNotice />}
      <Feedback error={cart.error || submit.error} />
      {cart.isPending ? (
        <p>Loading checkout…</p>
      ) : cart.data?.guest ? null : guestItems().length ? (
        <p>
          Resolve the remaining guest selections above before placing your
          order.
        </p>
      ) : cart.data?.quote ? (
        <div className="shopping-layout">
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate(e.currentTarget);
            }}
          >
            <h2>Delivery address</h2>
            {[
              ["name", "Full name"],
              ["email", "Email"],
              ["phone", "Phone"],
              ["line1", "Street address"],
              ["line2", "Apartment (optional)"],
              ["city", "City"],
              ["postalCode", "Postal code"],
            ].map(([name, label]) => (
              <label key={name}>
                {label}
                <input
                  name={name}
                  type={name === "email" ? "email" : "text"}
                  required={name !== "line2"}
                  minLength={
                    name === "line1"
                      ? 5
                      : name === "phone"
                        ? 7
                        : name === "email"
                          ? undefined
                          : name === "line2"
                            ? undefined
                            : 2
                  }
                  maxLength={
                    name === "line1" || name === "line2"
                      ? 200
                      : name === "email"
                        ? 254
                        : name === "phone"
                          ? 25
                          : name === "postalCode"
                            ? 20
                            : 80
                  }
                />
              </label>
            ))}
            <label>
              Country
              <select name="country">
                <option value="US">United States</option>
              </select>
            </label>
            <p>Payment: Cash on delivery</p>
            <button className="primary" disabled={submit.isPending}>
              {submit.isPending ? "Placing order…" : "Place order"}
            </button>
          </form>
          <Totals quote={cart.data.quote} />
        </div>
      ) : (
        <Link to="/cart">Review your cart to continue →</Link>
      )}
    </section>
  );
}
export function OrdersPage() {
  const [page, setPage] = useState(1);
  const result = useQuery({
    queryKey: ["orders", page],
    queryFn: async () =>
      (await api.get<{ orders: Order[] }>("/orders?page=" + page)).data,
    retry: false,
  });
  return (
    <section className="section">
      <h1>Your orders.</h1>
      <Feedback error={result.error} />
      {result.isPending ? (
        <p>Loading orders…</p>
      ) : (
        result.data?.orders.map((o) => (
          <article className="cart-row" key={o._id}>
            <Link to={"/orders/" + o._id}>Order {o._id.slice(-8)} →</Link>
            <span>{new Date(o.createdAt).toLocaleDateString()}</span>
            <strong>{money(o.total)}</strong>
          </article>
        ))
      )}
      {result.data?.orders.length === 0 && <p>No orders yet.</p>}
      <div className="pagination">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>
          Previous
        </button>
        <span>Page {page}</span>
        <button
          disabled={(result.data?.orders.length || 0) < 20}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
export function OrderPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const result = useQuery({
    queryKey: ["order", id],
    queryFn: async () =>
      (await api.get<{ order: Order }>("/orders/" + id)).data,
    retry: false,
  });
  const cancel = useMutation({
    mutationFn: async () => {
      await api.post("/orders/" + id + "/cancel");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["order", id] });
      void qc.invalidateQueries({ queryKey: ["orders"] });
    },
  });
  const o = result.data?.order;
  return (
    <section className="section">
      <h1>Order details.</h1>
      <Feedback error={result.error || cancel.error} />
      {result.isPending ? (
        <p>Loading order…</p>
      ) : (
        o && (
          <>
            <p>
              Order {o._id} · {new Date(o.createdAt).toLocaleDateString()}
            </p>
            <p>
              {o.address.name} · {o.address.line1}, {o.address.city}{" "}
              {o.address.postalCode}
            </p>
            <p>Cash on delivery · {o.paymentStatus}</p>
            {o.groups.map((g) => (
              <article className="seller-box" key={g._id}>
                <div>
                  <h2>{g.storeName}</h2>
                  <p>{g.status}</p>
                  {g.items.map((i) => (
                    <div key={i.product}>
                      <Link to={"/products/" + i.product}>{i.name}</Link> ×{" "}
                      {i.quantity} · {money(i.price)}{" "}
                      {g.status === "delivered" && (
                        <Link to={"/orders/" + o._id + "/review/" + i.product}>
                          Write a review →
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
            <Totals quote={o} />
            {!o.cancelledAt &&
              o.groups.every((g) =>
                ["pending", "confirmed"].includes(g.status),
              ) && (
                <button
                  className="secondary"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate()}
                >
                  Cancel order
                </button>
              )}
          </>
        )
      )}
    </section>
  );
}
