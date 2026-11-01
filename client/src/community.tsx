import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import axios from "axios";
import { api } from "./api";
function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p role="alert" className="commerce-error">
      {axios.isAxiosError(error)
        ? error.response?.data?.error || "Unable to connect. Please try again."
        : "Unable to complete the action."}
    </p>
  ) : null;
}
export function ProductReviews({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ["reviews", id, page],
    queryFn: async () =>
      (
        await api.get<{
          reviews: {
            _id: string;
            rating: number;
            comment: string;
            displayName: string;
            createdAt: string;
          }[];
          total: number;
        }>("/products/" + id + "/reviews", { params: { page } })
      ).data,
  });
  return (
    <div className="review-section">
      <h2>Customer reviews</h2>
      <p className="muted">
        Reviews from delivered purchases. To review a purchase, open it in your{" "}
        <Link to="/orders">orders</Link>.
      </p>
      {q.isPending ? (
        <p aria-busy>Loading reviews…</p>
      ) : q.isError ? (
        <>
          <ErrorMessage error={q.error} />
          <button className="secondary" onClick={() => void q.refetch()}>
            Retry reviews
          </button>
        </>
      ) : (
        <>
          {q.data.reviews.length ? (
            q.data.reviews.map((r) => (
              <article key={r._id} className="review-card">
                <div>
                  <b>{r.displayName}</b>
                  <span aria-label={r.rating + " out of 5 stars"}>
                    {"★".repeat(r.rating)}
                    {"☆".repeat(5 - r.rating)}
                  </span>
                </div>
                <small>
                  Verified delivered purchase ·{" "}
                  {new Date(r.createdAt).toLocaleDateString()}
                </small>
                <p>{r.comment}</p>
              </article>
            ))
          ) : (
            <p className="muted">
              No reviews yet. Be the first to share your experience after
              delivery.
            </p>
          )}
          {q.data.total > 10 && (
            <div className="pagination">
              <button disabled={page === 1} onClick={() => setPage(page - 1)}>
                ← Previous
              </button>
              <span>Page {page}</span>
              <button
                disabled={page * 10 >= q.data.total}
                onClick={() => setPage(page + 1)}
              >
                Next →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
const reviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().trim().min(3).max(2000),
});
export function ReviewPurchase() {
  const { orderId, productId } = useParams();
  const qc = useQueryClient();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm({
    resolver: zodResolver(reviewSchema),
    defaultValues: { rating: 5, comment: "" },
  });
  const submit = useMutation({
    mutationFn: (v: z.infer<typeof reviewSchema>) =>
      api.put("/products/" + productId + "/review", { ...v, order: orderId }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["reviews", productId] });
      void qc.invalidateQueries({ queryKey: ["product", productId] });
      void qc.invalidateQueries({ queryKey: ["products"] });
    },
  });
  return (
    <section className="section narrow">
      <p className="eyebrow">A delivered find. Your honest experience.</p>
      <h1>Review your purchase.</h1>
      <p className="muted">
        One review per product and order. Submitting again updates your existing
        review.
      </p>
      <form
        className="checkout-form"
        onSubmit={handleSubmit((v) => submit.mutate(v))}
      >
        <label>
          Rating
          <select {...register("rating", { valueAsNumber: true })}>
            {[5, 4, 3, 2, 1].map((n) => (
              <option key={n} value={n}>
                {n} {n === 1 ? "star" : "stars"}
              </option>
            ))}
          </select>
          <small>{errors.rating?.message}</small>
        </label>
        <label>
          Your experience
          <textarea {...register("comment")} rows={6} />
          <small>{errors.comment?.message}</small>
        </label>
        <ErrorMessage error={submit.error} />
        {submit.isSuccess && (
          <p role="status">
            Your review has been saved. Thank you for sharing your experience.
          </p>
        )}
        <button className="primary" disabled={submit.isPending}>
          {submit.isPending ? "Saving…" : "Save review"}
        </button>
      </form>
      <p>
        <Link to={"/orders/" + orderId}>← Back to your order</Link>
      </p>
      <Link to={"/products/" + productId}>View product and reviews →</Link>
    </section>
  );
}
export function NotificationsPage() {
  const [page, setPage] = useState(1),
    [unread, setUnread] = useState(false);
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ["notifications", page, unread],
    queryFn: async () =>
      (
        await api.get<{
          notifications: {
            _id: string;
            title: string;
            message: string;
            path: string;
            readAt: string | null;
            createdAt: string;
          }[];
          total: number;
          unread: number;
        }>("/notifications", {
          params: { page, ...(unread ? { unread: "true" } : {}) },
        })
      ).data,
    retry: false,
    refetchInterval: 60000,
  });
  const mark = useMutation({
    mutationFn: (id: string) =>
      api.patch("/notifications/" + (id === "all" ? "read-all" : id + "/read")),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  return (
    <section className="section">
      <p className="eyebrow">Stay in the loop</p>
      <h1>Your notifications.</h1>
      <div className="seller-toolbar">
        <label>
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => {
              setUnread(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Unread only
        </label>
        <button
          className="secondary"
          disabled={mark.isPending || !q.data?.unread}
          onClick={() => mark.mutate("all")}
        >
          Mark all read
        </button>
        <span className="muted">
          {q.data?.unread || 0} unread · updates every minute
        </span>
      </div>
      <ErrorMessage error={mark.error} />
      {q.isPending ? (
        <div className="state" aria-busy>
          Loading notifications…
        </div>
      ) : q.isError ? (
        <div className="state">
          <ErrorMessage error={q.error} />
          <Link to="/sign-in">Sign in →</Link>{" "}
          <button className="secondary" onClick={() => void q.refetch()}>
            Retry
          </button>
        </div>
      ) : (
        <>
          {q.data.notifications.length ? (
            q.data.notifications.map((n) => (
              <article
                className={"notification-card " + (!n.readAt ? "unread" : "")}
                key={n._id}
              >
                <div>
                  <h3>
                    {!n.readAt && <span className="unread-dot" />}
                    {n.title}
                  </h3>
                  <p>{n.message}</p>
                  <small>{new Date(n.createdAt).toLocaleString()}</small>
                </div>
                <Link
                  to={n.path}
                  onClick={() => {
                    if (!n.readAt) mark.mutate(n._id);
                  }}
                >
                  View →
                </Link>
                {!n.readAt && (
                  <button
                    className="text-button"
                    disabled={mark.isPending}
                    onClick={() => mark.mutate(n._id)}
                  >
                    Mark read
                  </button>
                )}
              </article>
            ))
          ) : (
            <div className="state">
              <h2>You’re all caught up.</h2>
              <p>No {unread ? "unread " : ""}notifications to show.</p>
            </div>
          )}
          <div className="pagination">
            <button disabled={page === 1} onClick={() => setPage(page - 1)}>
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
