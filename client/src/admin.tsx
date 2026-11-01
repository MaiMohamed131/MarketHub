import { useState } from "react";
import { Link, Navigate, useLocation, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import axios from "axios";
import { api, money, type Category } from "./api";
type Row = Record<string, any>;
function ErrorBox({ error }: { error: unknown }) {
  return error ? (
    <p className="commerce-error" role="alert">
      {axios.isAxiosError(error)
        ? error.response?.data?.error || "Unable to connect. Try again."
        : "Unable to complete the action."}
    </p>
  ) : null;
}
function Nav() {
  return (
    <nav className="seller-nav">
      <Link to="/admin">Overview</Link>
      {["users", "sellers", "products", "categories", "orders"].map((s) => (
        <Link key={s} to={"/admin/" + s}>
          {s[0].toUpperCase() + s.slice(1)}
        </Link>
      ))}
    </nav>
  );
}
function Frame({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const signIn =
    "/admin/sign-in?next=" +
    encodeURIComponent(location.pathname + location.search);
  const me = useQuery({
    queryKey: ["admin-access"],
    queryFn: async () => (await api.get("/users/me")).data.user,
    retry: false,
  });
  return (
    <section className="section">
      <Nav />
      {me.isPending ? (
        <div className="state">Checking administrator access…</div>
      ) : me.isError ? (
        axios.isAxiosError(me.error) && me.error.response?.status === 401 ? (
          <Navigate to={signIn} replace />
        ) : (
          <div className="state">
            <h2>Administrator access unavailable</h2>
            <ErrorBox error={me.error} />
            <Link className="primary" to={signIn}>
              Administrator sign in →
            </Link>{" "}
            <button className="secondary" onClick={() => void me.refetch()}>
              Try again
            </button>
          </div>
        )
      ) : me.data.role !== "admin" ? (
        <div className="state">
          <h2>Administrator access required</h2>
          <p>
            You’re signed in with an account that does not have administrator
            access. Sign in with your administrator account to continue.
          </p>
          <Link className="primary" to={signIn}>
            Sign in with an administrator account →
          </Link>{" "}
          <Link className="secondary" to="/">
            Return to marketplace
          </Link>
        </div>
      ) : (
        children
      )}
    </section>
  );
}
export function AdminDashboard() {
  return (
    <Frame>
      <Overview />
    </Frame>
  );
}
function Overview() {
  const q = useQuery({
    queryKey: ["admin-overview"],
    queryFn: async () => (await api.get("/admin/overview")).data,
    retry: false,
  });
  if (q.isPending)
    return (
      <div className="state" aria-busy>
        Loading platform overview…
      </div>
    );
  if (q.isError)
    return (
      <>
        <ErrorBox error={q.error} />
        <button className="secondary" onClick={() => void q.refetch()}>
          Retry
        </button>
      </>
    );
  const d = q.data,
    roles = Object.fromEntries(d.users.map((r: Row) => [r._id, r.count]));
  const max = Math.max(1, ...d.sales.map((s: Row) => s.revenue));
  return (
    <>
      <p className="eyebrow">Platform operations</p>
      <h1>MarketHub overview.</h1>
      <div className="seller-stats">
        {[
          ["Users", d.users.reduce((n: number, r: Row) => n + r.count, 0)],
          ["Customers", roles.customer || 0],
          ["Sellers", roles.seller || 0],
          ["Products", d.products],
          ["Orders", d.orders],
          ["Delivered revenue", money(d.revenue)],
          ["Pending applications", d.pendingApplications],
        ].map(([k, v]) => (
          <div key={k}>
            <span>{k}</span>
            <strong>{v}</strong>
          </div>
        ))}
      </div>
      <p className="muted">
        Revenue is delivered merchandise value, excluding shipping. Cash
        collection is not tracked; recent entries are orders, not payment
        transactions.
      </p>
      <div className="shopping-layout">
        <div>
          <h2>Monthly delivered sales</h2>
          {d.sales.length ? (
            <div className="sales-chart">
              {d.sales.map((s: Row) => (
                <div key={s._id}>
                  <span>{s._id}</span>
                  <div>
                    <i
                      style={{
                        width: Math.max(1, (s.revenue / max) * 100) + "%",
                      }}
                    />
                  </div>
                  <b>{money(s.revenue)}</b>
                </div>
              ))}
            </div>
          ) : (
            <div className="state">
              Sales analytics will appear after delivery.
            </div>
          )}
          <h2>Recent orders</h2>
          {d.recent.map((o: Row) => (
            <Link
              className="cart-row"
              key={o._id}
              to={"/admin/orders/" + o._id}
            >
              <div>
                <h3>#{o._id.slice(-8).toUpperCase()}</h3>
                <p>{new Date(o.createdAt).toLocaleString()}</p>
              </div>
              <b>{money(o.total)}</b>
              <span>{o.paymentStatus}</span>
            </Link>
          ))}
        </div>
        <aside className="summary-box">
          <h2>Management activity</h2>
          {d.events.length ? (
            d.events.map((e: Row) => (
              <div key={e._id}>
                <strong>{e.action}</strong>
                <p>{e.reason}</p>
                <small>{new Date(e.createdAt).toLocaleString()}</small>
                <hr />
              </div>
            ))
          ) : (
            <p className="muted">No recorded management events yet.</p>
          )}
        </aside>
      </div>
    </>
  );
}
export function AdminList({
  kind,
}: {
  kind: "users" | "sellers" | "products" | "orders";
}) {
  return (
    <Frame>
      <List key={kind} kind={kind} />
    </Frame>
  );
}
function List({ kind }: { kind: "users" | "sellers" | "products" | "orders" }) {
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState(""),
    [confirmation, setConfirmation] = useState<{
      row: Row;
      action: string;
    } | null>(null),
    [reason, setReason] = useState("");
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["admin-list", kind, page, search, filter],
    queryFn: async () =>
      (
        await api.get("/admin/" + kind, {
          params: {
            page,
            q: search,
            ...(filter
              ? {
                  [kind === "users"
                    ? "role"
                    : kind === "products"
                      ? "active"
                      : "status"]: filter,
                }
              : {}),
          },
        })
      ).data,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: async () => {
      const { row, action } = confirmation!;
      if (kind === "users")
        return api.patch("/admin/users/" + row._id + "/active", {
          active: !row.active,
          reason,
        });
      if (kind === "sellers")
        return api.patch("/admin/seller-applications/" + row._id, {
          status: action,
          reason,
        });
      if (action === "archive")
        return api.delete("/admin/products/" + row._id, { data: { reason } });
      return api.patch("/admin/products/" + row._id, {
        active: !row.active,
        version: row.__v,
        reason,
      });
    },
    onSuccess: () => {
      setConfirmation(null);
      setReason("");
      void qc.invalidateQueries({ queryKey: ["admin-list"] });
      void qc.invalidateQueries({ queryKey: ["admin-overview"] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
  const options =
    kind === "users"
      ? ["customer", "seller", "admin"]
      : kind === "sellers"
        ? ["pending", "approved", "rejected", "suspended"]
        : kind === "products"
          ? ["true", "false"]
          : [
              "pending",
              "confirmed",
              "processing",
              "shipped",
              "delivered",
              "cancelled",
            ];
  const ask = (row: Row, action: string) => {
    setConfirmation({ row, action });
    setReason("");
    mutation.reset();
  };
  const rows = q.data?.[kind] || [];
  return (
    <>
      <p className="eyebrow">Platform management</p>
      <h1>{kind[0].toUpperCase() + kind.slice(1)}.</h1>
      <div className="seller-toolbar">
        <label>
          Search
          <input
            maxLength={100}
            value={search}
            placeholder={
              kind === "orders"
                ? "Order ID or customer email"
                : "Search " + kind
            }
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          Filter
          <select
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All</option>
            {options.map((v) => (
              <option key={v} value={v}>
                {kind === "products"
                  ? v === "true"
                    ? "Active"
                    : "Inactive"
                  : v}
              </option>
            ))}
          </select>
        </label>
      </div>
      {confirmation && (
        <div role="alert" className="confirm-box">
          <h3>Confirm {confirmation.action}</h3>
          <p>
            {confirmation.row.name ||
              confirmation.row.storeName ||
              confirmation.row.email}
          </p>
          <label>
            Reason
            <input
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <ErrorBox error={mutation.error} />
          <button
            className="primary"
            disabled={reason.trim().length < 3 || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Confirm action
          </button>{" "}
          <button className="secondary" onClick={() => setConfirmation(null)}>
            Keep unchanged
          </button>
        </div>
      )}
      {q.isPending ? (
        <div className="state" aria-busy>
          Loading records…
        </div>
      ) : q.isError ? (
        <>
          <ErrorBox error={q.error} />
          <button className="secondary" onClick={() => void q.refetch()}>
            Retry
          </button>
        </>
      ) : (
        <>
          <p className="muted">{q.data.total} results</p>
          <div className="seller-table-wrap">
            <table className="seller-table">
              <thead>
                <tr>
                  <th>{kind === "orders" ? "Order" : "Name"}</th>
                  <th>Details</th>
                  <th>Status</th>
                  <th>Manage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: Row) => (
                  <tr key={r._id}>
                    <td>
                      {kind === "orders"
                        ? "#" + r._id.slice(-8).toUpperCase()
                        : r.name || r.storeName}
                    </td>
                    <td>
                      {kind === "products"
                        ? money(r.price) + " · " + r.storeName
                        : kind === "orders"
                          ? money(r.total)
                          : r.email}
                    </td>
                    <td>
                      {kind === "users"
                        ? r.role + " · " + (r.active ? "active" : "inactive")
                        : kind === "products"
                          ? r.deleted
                            ? "archived"
                            : r.moderationBlocked
                              ? "blocked"
                              : r.active
                                ? "active"
                                : "draft"
                          : kind === "orders"
                            ? r.groups.map((g: Row) => g.status).join(", ")
                            : r.status}
                    </td>
                    <td>
                      {kind === "users" ? (
                        <>
                          <Link to={"/admin/users/" + r._id}>Details</Link>
                          {r.role !== "admin" && (
                            <button
                              className="text-button"
                              onClick={() =>
                                ask(r, r.active ? "deactivate" : "activate")
                              }
                            >
                              {r.active ? "Deactivate" : "Activate"}
                            </button>
                          )}
                        </>
                      ) : kind === "sellers" ? (
                        <>
                          <details>
                            <summary>Application</summary>
                            <p>{r.description}</p>
                            <p>{r.phone}</p>
                            <p>{r.reason}</p>
                          </details>
                          {(r.status === "pending"
                            ? ["approved", "rejected"]
                            : r.status === "approved"
                              ? ["suspended"]
                              : r.status === "suspended"
                                ? ["approved"]
                                : []
                          ).map((a) => (
                            <button
                              key={a}
                              className="text-button"
                              onClick={() => ask(r, a)}
                            >
                              {a}
                            </button>
                          ))}
                        </>
                      ) : kind === "products" ? (
                        <>
                          <Link to={"/admin/products/" + r._id}>Review</Link>
                          {!r.deleted && (
                            <>
                              <button
                                className="text-button"
                                onClick={() =>
                                  ask(r, r.active ? "block" : "approve")
                                }
                              >
                                {r.active ? "Block" : "Approve"}
                              </button>
                              <button
                                className="text-button"
                                onClick={() => ask(r, "archive")}
                              >
                                Archive
                              </button>
                            </>
                          )}
                        </>
                      ) : (
                        <Link to={"/admin/orders/" + r._id}>View order →</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!rows.length && (
            <div className="state">No records match these filters.</div>
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
    </>
  );
}
export function AdminRecord({ kind }: { kind: "users" | "products" }) {
  return (
    <Frame>
      <RecordView kind={kind} />
    </Frame>
  );
}
function RecordView({ kind }: { kind: "users" | "products" }) {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["admin-record", kind, id],
    queryFn: async () => (await api.get("/admin/" + kind + "/" + id)).data,
    retry: false,
  });
  if (q.isPending) return <div className="state">Loading details…</div>;
  if (q.isError) return <ErrorBox error={q.error} />;
  const r = q.data[kind === "users" ? "user" : "product"];
  return (
    <>
      <Link to={"/admin/" + kind}>← Back to {kind}</Link>
      <h1>{r.name}</h1>
      {kind === "users" ? (
        <div className="summary-box">
          <p>
            {r.email} · {r.role}
          </p>
          <p>
            Account {r.active ? "active" : "inactive"} · Email{" "}
            {r.verified ? "verified" : "unverified"}
          </p>
          <p>Joined {new Date(r.createdAt).toLocaleDateString()}</p>
          {q.data.application && (
            <p>
              Seller application: {q.data.application.storeName} ·{" "}
              {q.data.application.status}
            </p>
          )}
        </div>
      ) : (
        <>
          <p>
            {r.storeName} · {money(r.price)} · {r.stock} units
          </p>
          <p>{r.description}</p>
          <div className="upload-gallery">
            {r.images.map((url: string) => (
              <img key={url} src={url} alt={r.name} />
            ))}
          </div>
          <p className="muted">
            Seller ID: {r.seller}. Category ID: {r.category}. Delivered units:{" "}
            {r.salesCount}.
          </p>
          <Link to="/admin/products">Return to product moderation →</Link>
        </>
      )}
    </>
  );
}
type ManagedCategory = Category & { active: boolean; __v: number };
export function AdminCategories() {
  return (
    <Frame>
      <Categories />
    </Frame>
  );
}
function Categories() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<ManagedCategory | null | undefined>(
      undefined,
    ),
    [remove, setRemove] = useState<ManagedCategory | null>(null);
  const q = useQuery({
    queryKey: ["admin-categories"],
    queryFn: async () =>
      (await api.get<{ categories: ManagedCategory[] }>("/admin/categories"))
        .data.categories,
    retry: false,
  });
  const del = useMutation({
    mutationFn: () => api.delete("/admin/categories/" + remove!._id),
    onSuccess: () => {
      setRemove(null);
      void qc.invalidateQueries({ queryKey: ["admin-categories"] });
    },
  });
  return (
    <>
      <div className="section-heading">
        <h1>Categories.</h1>
        <button className="primary" onClick={() => setEditing(null)}>
          + Add category
        </button>
      </div>
      {editing !== undefined && (
        <CategoryForm
          key={editing?._id || "new"}
          category={editing}
          close={() => setEditing(undefined)}
        />
      )}
      <ErrorBox error={del.error} />
      {remove && (
        <div className="confirm-box" role="alert">
          <p>
            Delete {remove.name}? Only categories without any product references
            can be deleted. Otherwise deactivate it.
          </p>
          <button
            className="primary"
            disabled={del.isPending}
            onClick={() => del.mutate()}
          >
            Delete unused category
          </button>{" "}
          <button className="secondary" onClick={() => setRemove(null)}>
            Keep category
          </button>
        </div>
      )}
      {q.isPending ? (
        <div className="state">Loading categories…</div>
      ) : q.isError ? (
        <ErrorBox error={q.error} />
      ) : (
        q.data.map((c) => (
          <div className="cart-row" key={c._id}>
            <div>
              <h3>{c.name}</h3>
              <p>
                {c.slug} · {c.active ? "active" : "inactive"}
              </p>
              <p>{c.description}</p>
            </div>
            <button className="secondary" onClick={() => setEditing(c)}>
              Edit
            </button>
            <button className="text-button" onClick={() => setRemove(c)}>
              Delete
            </button>
          </div>
        ))
      )}
    </>
  );
}
function CategoryForm({
  category,
  close,
}: {
  category: ManagedCategory | null;
  close: () => void;
}) {
  const qc = useQueryClient();
  const [image, setImage] = useState(category?.image || "");
  const { register, handleSubmit } = useForm({
    defaultValues: {
      name: category?.name || "",
      slug: category?.slug || "",
      description: category?.description || "",
      active: category?.active ?? true,
    },
  });
  const upload = useMutation({
    mutationFn: async (f: File) => {
      const data = new FormData();
      data.append("image", f);
      return (await api.post("/admin/images", data, { timeout: 60000 })).data
        .url;
    },
    onSuccess: setImage,
  });
  const save = useMutation({
    mutationFn: async (v: Row) => {
      await (category
        ? api.patch("/admin/categories/" + category._id, {
            ...v,
            image,
            version: category.__v,
          })
        : api.post("/admin/categories", { ...v, image }));
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin-categories"] });
      void qc.invalidateQueries({ queryKey: ["categories"] });
      close();
    },
  });
  return (
    <form
      className="checkout-form category-editor"
      onSubmit={handleSubmit((v) => save.mutate(v))}
    >
      <h2>{category ? "Edit category" : "New category"}</h2>
      <label>
        Name
        <input required minLength={2} maxLength={80} {...register("name")} />
      </label>
      <label>
        Slug
        <input
          required
          maxLength={100}
          pattern="[a-z0-9]+(-[a-z0-9]+)*"
          {...register("slug")}
        />
      </label>
      <label>
        Description
        <textarea rows={3} maxLength={500} {...register("description")} />
      </label>
      <label>
        <span>
          <input type="checkbox" {...register("active")} /> Active category
        </span>
      </label>
      {image && (
        <div className="upload-gallery">
          <img src={image} alt="Category" />
          <button
            type="button"
            className="text-button"
            onClick={() => setImage("")}
          >
            Remove image
          </button>
        </div>
      )}
      <label>
        Category image (PNG/JPEG/WebP, up to 4 MB)
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          disabled={upload.isPending}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload.mutate(f);
            e.target.value = "";
          }}
        />
      </label>
      {upload.isPending && <p role="status">Uploading…</p>}
      <ErrorBox error={upload.error} />
      <ErrorBox error={save.error} />
      <button className="primary" disabled={save.isPending || upload.isPending}>
        Save category
      </button>{" "}
      <button type="button" className="secondary" onClick={close}>
        Close editor
      </button>
    </form>
  );
}
export function AdminOrder() {
  return (
    <Frame>
      <OrderView />
    </Frame>
  );
}
function OrderView() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false),
    [subject, setSubject] = useState(""),
    [notes, setNotes] = useState(""),
    [resolution, setResolution] = useState("");
  const q = useQuery({
    queryKey: ["admin-order", id],
    queryFn: async () => (await api.get("/admin/orders/" + id)).data,
    retry: false,
  });
  const action = useMutation({
    mutationFn: async (v: { type: string; dispute?: string }) =>
      v.type === "cancel"
        ? api.post("/admin/orders/" + id + "/cancel")
        : v.type === "open"
          ? api.post("/admin/orders/" + id + "/disputes", { subject, notes })
          : api.patch("/admin/orders/" + id + "/disputes/" + v.dispute, {
              notes: resolution,
            }),
    onSuccess: () => {
      setConfirm(false);
      setSubject("");
      setNotes("");
      setResolution("");
      void qc.invalidateQueries({ queryKey: ["admin-order", id] });
      void qc.invalidateQueries({ queryKey: ["admin-list", "orders"] });
    },
  });
  if (q.isPending) return <div className="state">Loading order…</div>;
  if (q.isError) return <ErrorBox error={q.error} />;
  const o = q.data.order;
  return (
    <>
      <Link to="/admin/orders">← All orders</Link>
      <h1>Order #{o._id.slice(-8).toUpperCase()}</h1>
      <p>
        {new Date(o.createdAt).toLocaleString()} · {money(o.total)} · Cash on
        Delivery · {o.paymentStatus}
      </p>
      <p className="muted">
        Customer: {o.address.name}, {o.address.email}, {o.address.phone}.
        Address: {o.address.line1}, {o.address.line2} {o.address.city}{" "}
        {o.address.postalCode} {o.address.country}
      </p>
      {o.groups.map((g: Row) => (
        <div className="fulfillment" key={g._id}>
          <div className="section-heading">
            <h2>{g.storeName}</h2>
            <span className="status-pill">{g.status}</span>
          </div>
          {g.items.map((i: Row) => (
            <div className="cart-row" key={i.product}>
              <span>
                {i.quantity} × {i.name}
              </span>
              <b>{money(i.price * i.quantity)}</b>
            </div>
          ))}
          <p>Store shipping: {money(g.shipping)}</p>
        </div>
      ))}
      <ErrorBox error={action.error} />
      {!o.cancelledAt &&
        o.groups.every((g: Row) =>
          ["pending", "confirmed"].includes(g.status),
        ) &&
        (confirm ? (
          <div className="confirm-box" role="alert">
            <p>Cancel all fulfillment groups and restore their stock?</p>
            <button
              className="primary"
              disabled={action.isPending}
              onClick={() => action.mutate({ type: "cancel" })}
            >
              Confirm cancellation
            </button>{" "}
            <button className="secondary" onClick={() => setConfirm(false)}>
              Keep order
            </button>
          </div>
        ) : (
          <button className="secondary" onClick={() => setConfirm(true)}>
            Cancel eligible order
          </button>
        ))}
      <section className="review-section">
        <h2>Order disputes</h2>
        <p className="muted">
          Internal case management. Resolving a case does not issue refunds or
          change fulfillment.
        </p>
        {q.data.disputes.map((d: Row) => (
          <div className="fulfillment" key={d._id}>
            <h3>
              {d.subject} <span className="status-pill">{d.status}</span>
            </h3>
            <p>{d.notes}</p>
            {d.resolution && (
              <p>
                <strong>Resolution:</strong> {d.resolution}
              </p>
            )}
            {d.status === "open" && (
              <>
                <label>
                  Resolution notes
                  <textarea
                    minLength={10}
                    maxLength={3000}
                    value={resolution}
                    onChange={(e) => setResolution(e.target.value)}
                  />
                </label>
                <button
                  className="secondary"
                  disabled={resolution.trim().length < 10 || action.isPending}
                  onClick={() =>
                    action.mutate({ type: "resolve", dispute: d._id })
                  }
                >
                  Resolve case
                </button>
              </>
            )}
          </div>
        ))}
        <form
          className="checkout-form seller-form"
          onSubmit={(e) => {
            e.preventDefault();
            action.mutate({ type: "open" });
          }}
        >
          <label>
            Case subject
            <input
              required
              minLength={3}
              maxLength={120}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
            />
          </label>
          <label>
            Internal notes
            <textarea
              required
              minLength={10}
              maxLength={3000}
              rows={4}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <button className="primary" disabled={action.isPending}>
            Open dispute case
          </button>
        </form>
      </section>
    </>
  );
}
