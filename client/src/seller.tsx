import { useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useSearchParams,
  useParams,
  useNavigate,
} from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import axios from "axios";
import { api, money, useCategories, type Product } from "./api";
type Application = {
  _id: string;
  storeName: string;
  description: string;
  email: string;
  phone: string;
  status: string;
  reason: string;
};
type ManagedProduct = Product & {
  __v: number;
  active: boolean;
  salesCount: number;
};
const errorText = (e: unknown) =>
  axios.isAxiosError(e)
    ? e.response?.data?.error || "Unable to connect. Try again."
    : e instanceof Error
      ? e.message
      : "Something went wrong";
function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="commerce-error">
      {errorText(error)}
    </p>
  ) : null;
}
function LoadingError({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: unknown;
  retry: () => unknown;
}) {
  return (
    <div className="state">
      {pending ? (
        <p aria-busy>Loading your seller workspace…</p>
      ) : (
        <>
          <h2>
            {axios.isAxiosError(error) && error.response?.status === 401
              ? "Sign in to your seller account"
              : "Seller workspace unavailable"}
          </h2>
          <ErrorMessage error={error} />
          <Link className="primary" to="/seller/sign-in">
            Sign in
          </Link>{" "}
          <button className="secondary" onClick={() => void retry()}>
            Retry
          </button>
        </>
      )}
    </div>
  );
}
export function SellerWorkspaceLayout() {
  const { pathname } = useLocation();
  const current = useQuery({
    queryKey: ["seller-application"],
    queryFn: async () =>
      (
        await api.get<{ application: Application | null }>(
          "/seller/application",
        )
      ).data.application,
    retry: false,
  });
  const applicationPage = pathname === "/seller/application";
  return (
    <>
      <div className="seller-workspace-bar">
        <div className="seller-workspace-title">
          <span className="eyebrow">SELLER CENTER</span>
          <strong>{current.data?.storeName || "Your store workspace"}</strong>
        </div>
        <nav className="seller-nav" aria-label="Seller navigation">
          <NavLink to="/seller" end>
            Overview
          </NavLink>
          <NavLink to="/seller/products" end>
            Products & inventory
          </NavLink>
          <NavLink to="/seller/orders">Orders</NavLink>
          <NavLink to="/seller/application">Store status</NavLink>
        </nav>
        <NavLink
          className="primary seller-add-product"
          to="/seller/products/new"
        >
          + Add product
        </NavLink>
      </div>
      {applicationPage ? (
        <Outlet />
      ) : current.isPending ? (
        <LoadingError pending error={null} retry={current.refetch} />
      ) : current.isError ? (
        <LoadingError
          pending={false}
          error={current.error}
          retry={current.refetch}
        />
      ) : current.data?.status === "approved" ? (
        <Outlet />
      ) : (
        <section className="section">
          <div className="state">
            <h1>
              {current.data
                ? "Your store needs approval"
                : "Set up your seller account"}
            </h1>
            <p>
              {current.data?.status === "pending"
                ? "Your application is being reviewed. You can add products once your store is approved."
                : current.data?.status === "suspended"
                  ? "Your store is suspended. Review your store status for more information."
                  : "Submit your store application to start selling. Approved sellers can create drafts, upload images, and publish products."}
            </p>
            {current.data?.reason && <p>{current.data.reason}</p>}
            <Link className="primary" to="/seller/application">
              {current.data ? "View store status" : "Apply to sell"} →
            </Link>
          </div>
        </section>
      )}
    </>
  );
}
const application = z.object({
  storeName: z.string().trim().min(2).max(100),
  description: z.string().trim().min(30).max(2000),
  email: z.email(),
  phone: z.string().regex(/^[+\d ()-]{7,25}$/),
});
export function SellerApplicationPage() {
  const qc = useQueryClient();
  const current = useQuery({
    queryKey: ["seller-application"],
    queryFn: async () =>
      (
        await api.get<{ application: Application | null }>(
          "/seller/application",
        )
      ).data.application,
    retry: false,
  });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({ resolver: zodResolver(application) });
  const submit = useMutation({
    mutationFn: (v: z.infer<typeof application>) =>
      api.post("/seller/application", v),
    onSuccess: () =>
      void qc.invalidateQueries({ queryKey: ["seller-application"] }),
  });
  if (current.isPending || current.isError)
    return (
      <LoadingError
        pending={current.isPending}
        error={current.error}
        retry={current.refetch}
      />
    );
  const a = current.data;
  return (
    <section className="section">
      <p className="eyebrow">Independent business. Shared possibilities.</p>
      <h1>Your store starts here.</h1>
      {a && (
        <div className="application-status">
          <h2>{a.storeName}</h2>
          <span className="status-pill">{a.status}</span>
          <p>
            {a.reason ||
              "Your application is waiting for administrator review."}
          </p>
          {a.status === "approved" && (
            <Link className="primary" to="/seller">
              Open seller dashboard ↗
            </Link>
          )}
        </div>
      )}
      {(!a || a.status === "rejected") && (
        <form
          className="checkout-form seller-form"
          onSubmit={handleSubmit((v) => submit.mutate(v))}
        >
          <p className="muted">
            Tell us about your business. Only approved stores can publish
            products.
          </p>
          {(["storeName", "description", "email", "phone"] as const).map(
            (k) => (
              <label key={k}>
                {
                  {
                    storeName: "Store name",
                    description: "About your business (at least 30 characters)",
                    email: "Business email",
                    phone: "Business phone",
                  }[k]
                }
                {k === "description" ? (
                  <textarea {...register(k)} rows={5} />
                ) : (
                  <input
                    {...register(k)}
                    type={k === "email" ? "email" : "text"}
                  />
                )}
                <small role="alert">{errors[k]?.message}</small>
              </label>
            ),
          )}
          <ErrorMessage error={submit.error} />
          <button className="primary" disabled={submit.isPending}>
            {submit.isPending ? "Submitting…" : "Submit application"}
          </button>
        </form>
      )}
    </section>
  );
}
type Fulfillment = {
  _id: string;
  createdAt: string;
  address?: {
    name: string;
    line1: string;
    city: string;
    postalCode: string;
    phone: string;
  };
  groups: {
    _id: string;
    storeName: string;
    status: string;
    subtotal: number;
    items: { name: string; price: number; quantity: number }[];
  }[];
};
export function SellerDashboard() {
  const q = useQuery({
    queryKey: ["seller-overview"],
    queryFn: async () =>
      (
        await api.get<{
          totalProducts: number;
          lowStock: { _id: string; name: string; stock: number }[];
          stats: {
            totalOrders: number;
            pendingOrders: number;
            completedOrders: number;
            totalSales: number;
          };
          recent: Fulfillment[];
        }>("/seller/manage/overview")
      ).data,
    retry: false,
  });
  if (q.isPending || q.isError)
    return (
      <LoadingError pending={q.isPending} error={q.error} retry={q.refetch} />
    );
  const d = q.data;
  return (
    <section className="section">
      <p className="eyebrow">Your independent business, at a glance</p>
      <div className="section-heading">
        <h1>Seller overview.</h1>
        <Link className="primary" to="/seller/products/new">
          + Add product
        </Link>
      </div>
      <div className="seller-stats">
        {[
          ["Products", d.totalProducts],
          ["Orders", d.stats.totalOrders],
          ["Delivered sales", money(d.stats.totalSales)],
          ["Open orders", d.stats.pendingOrders],
          ["Completed orders", d.stats.completedOrders],
        ].map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <p className="muted">
        Delivered sales exclude shipping and cancelled orders. Cash collection
        is not tracked.
      </p>
      <div className="shopping-layout">
        <div>
          <h2>Recent sales activity</h2>
          {d.recent.length ? (
            d.recent.map((o) => (
              <Link to="/seller/orders" key={o._id} className="cart-row">
                <div>
                  <h3>Order #{o._id.slice(-8).toUpperCase()}</h3>
                  <p>{new Date(o.createdAt).toLocaleDateString()}</p>
                </div>
                <strong>
                  {money(o.groups.reduce((s, g) => s + g.subtotal, 0))}
                </strong>
                <span>{o.groups.map((g) => g.status).join(", ")}</span>
              </Link>
            ))
          ) : (
            <div className="state">Your first order is ahead of you.</div>
          )}
        </div>
        <aside className="summary-box">
          <h2>Low-stock watch</h2>
          <p className="muted">Products with 5 or fewer units.</p>
          {d.lowStock.length ? (
            d.lowStock.map((p) => (
              <Link
                className="cart-row"
                to={"/seller/products/" + p._id}
                key={p._id}
              >
                <span>{p.name}</span>
                <b>{p.stock} left</b>
              </Link>
            ))
          ) : (
            <p>Your inventory is looking healthy.</p>
          )}
          <Link to="/seller/products?low=true">View inventory →</Link>
        </aside>
      </div>
    </section>
  );
}
export function SellerProducts() {
  const [params] = useSearchParams();
  const saved = params.get("saved");
  const savedProduct = params.get("product") || "";
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [low, setLow] = useState(false),
    [remove, setRemove] = useState<string | null>(null);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["seller-products", page, search, low],
    queryFn: async () =>
      (
        await api.get<{ products: ManagedProduct[]; total: number }>(
          "/seller/manage/products",
          { params: { page, q: search, ...(low ? { low: "true" } : {}) } },
        )
      ).data,
    retry: false,
  });
  const archive = useMutation({
    mutationFn: (id: string) => api.delete("/seller/manage/products/" + id),
    onSuccess: () => {
      setRemove(null);
      void qc.invalidateQueries({ queryKey: ["seller-products"] });
      void qc.invalidateQueries({ queryKey: ["seller-overview"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Build your collection</p>
          <h1>Products & inventory.</h1>
        </div>
        <Link className="primary" to="/seller/products/new">
          + Add product
        </Link>
      </div>
      {(saved === "draft" || saved === "published") && (
        <div className="application-status" role="status">
          <h2>
            {saved === "draft"
              ? "Product saved as a draft"
              : "Product published"}
          </h2>
          <p>
            {saved === "draft"
              ? "This product is only visible in your seller workspace. Open it, enable Publish this listing, and publish it to show it in the marketplace."
              : "Your product is now available in the marketplace."}
          </p>
          {/^[a-f\d]{24}$/i.test(savedProduct) && (
            <Link
              className="primary"
              to={
                saved === "draft"
                  ? "/seller/products/" + savedProduct
                  : "/products/" + savedProduct
              }
            >
              {saved === "draft"
                ? "Open draft to publish →"
                : "View in marketplace →"}
            </Link>
          )}
        </div>
      )}
      <div className="seller-toolbar">
        <label>
          Search products
          <input
            value={search}
            maxLength={100}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          <input
            type="checkbox"
            checked={low}
            onChange={(e) => {
              setLow(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Low stock only
        </label>
      </div>
      <ErrorMessage error={archive.error} />
      {remove && (
        <div className="confirm-box" role="alert">
          <p>
            Archive this product? It will leave the marketplace. Existing orders
            keep their historical details.
          </p>
          <button
            className="primary"
            disabled={archive.isPending}
            onClick={() => archive.mutate(remove)}
          >
            Archive product
          </button>{" "}
          <button className="secondary" onClick={() => setRemove(null)}>
            Keep product
          </button>
        </div>
      )}
      {q.isPending || q.isError ? (
        <LoadingError pending={q.isPending} error={q.error} retry={q.refetch} />
      ) : (
        <>
          <p className="muted">{q.data.total} products</p>
          <div className="seller-table-wrap">
            <table className="seller-table">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Price</th>
                  <th>Stock</th>
                  <th>Status</th>
                  <th>Delivered units</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {q.data.products.map((p) => (
                  <tr key={p._id}>
                    <td>
                      <Link to={"/seller/products/" + p._id}>{p.name}</Link>
                    </td>
                    <td>{money(p.price)}</td>
                    <td className={p.stock <= 5 ? "commerce-error" : ""}>
                      {p.stock}
                      {p.stock <= 5 ? " · Low" : ""}
                    </td>
                    <td>
                      {p.active
                        ? "Published"
                        : "Draft — hidden from marketplace"}
                    </td>
                    <td>{p.salesCount}</td>
                    <td>
                      <Link to={"/seller/products/" + p._id}>Edit</Link>{" "}
                      <button
                        className="text-button"
                        onClick={() => setRemove(p._id)}
                      >
                        Archive
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!q.data.products.length && (
            <div className="state">
              No products match. Add a product or adjust the filters.
            </div>
          )}
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
              ← Previous
            </button>
            <span>Page {page}</span>
            <button
              disabled={page * 20 >= q.data.total}
              onClick={() => setPage(page + 1)}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </section>
  );
}
const editSchema = z.object({
  name: z.string().min(3).max(160),
  description: z.string().min(20).max(12000),
  price: z
    .string()
    .regex(/^\d{1,7}(\.\d{1,2})?$/)
    .refine(
      (v) => Number(v) > 0 && Number(v) <= 1000000,
      "Use a price between $0.01 and $1,000,000",
    ),
  stock: z.number().int().min(0).max(1000000),
  category: z.string().regex(/^[a-f\d]{24}$/i),
  active: z.boolean(),
});
function ProductEditorForm({ product }: { product?: ManagedProduct }) {
  const nav = useNavigate(),
    qc = useQueryClient();
  const cats = useCategories();
  const [images, setImages] = useState(product?.images || []);
  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: product?.name || "",
      description: product?.description || "",
      price: product ? (product.price / 100).toFixed(2) : "",
      stock: product?.stock || 0,
      category:
        typeof product?.category === "string"
          ? product.category
          : product?.category?._id || "",
      active: product?.active || false,
    },
  });
  const publishing = watch("active");
  const save = useMutation({
    mutationFn: async (v: z.infer<typeof editSchema>) => {
      if (v.active && images.length === 0)
        throw Error(
          "Upload at least one product image before publishing, or uncheck Publish this listing to save a draft.",
        );
      const { stock, ...fields } = v;
      const data = {
        ...fields,
        price: Math.round(Number(v.price) * 100),
        images,
      };
      return product
        ? api.patch("/seller/manage/products/" + product._id, {
            ...data,
            version: product.__v,
          })
        : api.post("/seller/manage/products", { ...data, stock });
    },
    onSuccess: (response) => {
      void qc.invalidateQueries({ queryKey: ["seller-products"] });
      void qc.invalidateQueries({ queryKey: ["seller-overview"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
      void qc.invalidateQueries({ queryKey: ["product"] });
      nav(
        "/seller/products?saved=" +
          (response.data.product.active ? "published" : "draft") +
          "&product=" +
          response.data.product._id,
      );
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 4 * 1024 * 1024) throw Error("Image exceeds 4 MB");
      const form = new FormData();
      form.append("image", file);
      return (
        await api.post<{ url: string }>("/seller/manage/images", form, {
          timeout: 60000,
        })
      ).data.url;
    },
    onSuccess: (url) => setImages((old) => [...old, url]),
  });
  const removeUpload = useMutation({
    mutationFn: (url: string) =>
      api.delete("/seller/manage/images", { data: { url } }),
    onSuccess: (_response, url) =>
      setImages((old) => old.filter((image) => image !== url)),
  });
  const [delta, setDelta] = useState(0);
  const stock = useMutation({
    mutationFn: () =>
      api.post("/seller/manage/products/" + product!._id + "/inventory", {
        delta,
        expectedStock: product!.stock,
      }),
    onSuccess: () => {
      setDelta(0);
      void qc.invalidateQueries({ queryKey: ["seller-product", product!._id] });
      void qc.invalidateQueries({ queryKey: ["seller-overview"] });
    },
  });
  return (
    <div className="shopping-layout">
      <form
        className="checkout-form"
        onSubmit={handleSubmit((v) => save.mutate(v))}
      >
        <label>
          Product name
          <input {...register("name")} />
          <small>{errors.name?.message}</small>
        </label>
        <label>
          Description
          <textarea {...register("description")} rows={6} />
          <small>{errors.description?.message}</small>
        </label>
        <label>
          Price (USD)
          <input {...register("price")} inputMode="decimal" />
          <small>{errors.price?.message}</small>
        </label>
        <label>
          Category
          <select {...register("category")}>
            <option value="">Select a category</option>
            {cats.data?.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
          <small>{errors.category?.message}</small>
        </label>
        {cats.isError && (
          <button
            type="button"
            className="text-button"
            onClick={() => void cats.refetch()}
          >
            Retry categories
          </button>
        )}
        {!product && (
          <label>
            Initial stock
            <input
              type="number"
              {...register("stock", { valueAsNumber: true })}
            />
            <small>{errors.stock?.message}</small>
          </label>
        )}
        <div className="application-status">
          <h2>Marketplace visibility</h2>
          <label>
            <span>
              <input type="checkbox" {...register("active")} /> Publish this
              listing — make it visible to shoppers
            </span>
          </label>
          <p className="muted">
            {publishing
              ? "This product will appear in the marketplace after publishing. At least one uploaded image is required."
              : "Draft mode: this product will NOT appear in the marketplace. Enable publishing above when it is ready for shoppers."}
          </p>
        </div>
        <h2>Product images</h2>
        <div className="upload-gallery">
          {images.map((url, i) => (
            <div key={url}>
              <img src={url} alt={"Product image " + (i + 1)} />
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  product?.images.includes(url)
                    ? setImages(images.filter((_, index) => i !== index))
                    : removeUpload.mutate(url)
                }
              >
                Remove
              </button>
            </div>
          ))}
        </div>
        <label>
          Upload PNG, JPEG, or WebP (4 MB max, 8 images)
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={upload.isPending || images.length >= 8}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
        </label>
        {upload.isPending && <p role="status">Uploading image…</p>}
        <ErrorMessage error={upload.error} />
        <ErrorMessage error={removeUpload.error} />
        <ErrorMessage error={save.error} />
        <button
          className="primary"
          disabled={
            save.isPending || upload.isPending || removeUpload.isPending
          }
        >
          {save.isPending
            ? "Saving…"
            : publishing
              ? "Publish product"
              : "Save draft"}
        </button>
      </form>
      <aside className="summary-box">
        <h2>{product ? "Inventory adjustment" : "Inventory guidance"}</h2>
        {product ? (
          <>
            <p>
              <strong>{product.stock}</strong> units currently available
            </p>
            <p className="muted">
              Enter units received as a positive number, or remove damaged stock
              with a negative number. Refresh if stock changes during editing.
            </p>
            <label>
              Adjustment
              <input
                type="number"
                value={delta}
                min={-product.stock}
                max={1000000 - product.stock}
                onChange={(e) => setDelta(Number(e.target.value))}
              />
            </label>
            <ErrorMessage error={stock.error} />
            <button
              className="primary"
              disabled={
                !Number.isInteger(delta) || delta === 0 || stock.isPending
              }
              onClick={() => stock.mutate()}
            >
              Apply adjustment
            </button>
            <p className="muted">
              Delivered units: {product.salesCount}. Rating:{" "}
              {product.reviewCount
                ? product.averageRating.toFixed(1)
                : "No ratings yet"}
              .
            </p>
          </>
        ) : (
          <p className="muted">
            Stock is deducted only when an order succeeds. Low-stock products
            appear on your overview when 5 or fewer units remain.
          </p>
        )}
      </aside>
    </div>
  );
}
export function SellerProductEditor() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["seller-product", id],
    queryFn: async () =>
      (
        await api.get<{ product: ManagedProduct }>(
          "/seller/manage/products/" + id,
        )
      ).data.product,
    enabled: Boolean(id),
    retry: false,
  });
  return (
    <section className="section">
      <p className="eyebrow">A new favorite starts here</p>
      <h1>{id ? "Edit product." : "Add a product."}</h1>
      {id && (q.isPending || q.isError) ? (
        <LoadingError pending={q.isPending} error={q.error} retry={q.refetch} />
      ) : (
        <ProductEditorForm
          key={q.data?._id + ":" + q.data?.__v}
          product={q.data}
        />
      )}
    </section>
  );
}
export function SellerOrders() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["seller-orders"],
    queryFn: async () =>
      (await api.get<{ orders: Fulfillment[] }>("/seller/orders")).data.orders,
    retry: false,
  });
  const next: Record<string, string> = {
    pending: "confirmed",
    confirmed: "processing",
    processing: "shipped",
    shipped: "delivered",
  };
  const update = useMutation({
    mutationFn: (v: { order: string; group: string; status: string }) =>
      api.patch("/seller/orders/" + v.order + "/groups/" + v.group, {
        status: v.status,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["seller-orders"] });
      void qc.invalidateQueries({ queryKey: ["seller-overview"] });
    },
  });
  return (
    <section className="section">
      <h1>Your store deliveries.</h1>
      <p className="muted">
        Latest 50 orders containing your products. Each action affects only your
        fulfillment group.
      </p>
      <ErrorMessage error={update.error} />
      {q.isPending || q.isError ? (
        <LoadingError pending={q.isPending} error={q.error} retry={q.refetch} />
      ) : q.data.length ? (
        q.data.map((o) => (
          <div className="fulfillment" key={o._id}>
            <p className="eyebrow">Order #{o._id.slice(-8).toUpperCase()}</p>
            {o.groups.map((g) => (
              <div key={g._id}>
                <div className="section-heading">
                  <h2>{g.storeName}</h2>
                  <span className="status-pill">{g.status}</span>
                </div>
                {g.items.map((i, index) => (
                  <div className="cart-row" key={index}>
                    <span>
                      {i.quantity} × {i.name}
                    </span>
                    <b>{money(i.price * i.quantity)}</b>
                  </div>
                ))}
                {o.address && (
                  <p className="muted">
                    Ship to: {o.address.name}, {o.address.line1},{" "}
                    {o.address.city} {o.address.postalCode}. Contact:{" "}
                    {o.address.phone}
                  </p>
                )}
                {next[g.status] && (
                  <button
                    className="primary"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({
                        order: o._id,
                        group: g._id,
                        status: next[g.status],
                      })
                    }
                  >
                    Mark {next[g.status]}
                  </button>
                )}
              </div>
            ))}
          </div>
        ))
      ) : (
        <div className="state">No orders yet.</div>
      )}
    </section>
  );
}
