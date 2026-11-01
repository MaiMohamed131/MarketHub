import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { api, setAccessToken } from "./api";
import { guestItems, mergeGuestCart } from "./guest-cart";
const password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (v) => new TextEncoder().encode(v).length <= 72,
    "Use at most 72 UTF-8 bytes",
  );
const schema = z.object({
  email: z.string(),
  name: z.string(),
  password: z.string(),
  confirm: z.string(),
});
function ErrorMessage({ error }: { error: unknown }) {
  return error ? (
    <p className="commerce-error" role="alert">
      {axios.isAxiosError(error)
        ? error.response?.data?.error || "Unable to connect. Try again."
        : "Unable to complete this action."}
    </p>
  ) : null;
}
export function AuthPage({
  mode,
  administrator = false,
  seller = false,
}: {
  administrator?: boolean;
  seller?: boolean;
  mode:
    | "login"
    | "register"
    | "forgot"
    | "request-verification"
    | "verify"
    | "reset";
}) {
  const nav = useNavigate(),
    qc = useQueryClient();
  const [params] = useSearchParams();
  const [token] = useState(() => params.get("token") || "");
  const [hadGuestCart] = useState(() => guestItems().length > 0);
  const checkoutQuery =
    params.get("next") === "/checkout" ? "?next=%2Fcheckout" : "";
  const [validation, setValidation] = useState("");
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { email: "", name: "", password: "", confirm: "" },
  });
  const submit = useMutation({
    mutationFn: async (v: z.infer<typeof schema>) => {
      setValidation("");
      if (
        ["login", "register", "forgot", "request-verification"].includes(
          mode,
        ) &&
        !z.email().safeParse(v.email).success
      )
        throw Error("Enter a valid email address");
      if (
        ["login", "register", "reset"].includes(mode) &&
        !password.safeParse(v.password).success
      )
        throw Error("Use 12–72 characters and at most 72 UTF-8 bytes");
      if (["register", "reset"].includes(mode) && v.password !== v.confirm)
        throw Error("Passwords must match");
      if (mode === "register" && v.name.trim().length < 2)
        throw Error("Enter your name (at least 2 characters)");
      if (["verify", "reset"].includes(mode) && !/^[a-f0-9]{64}$/.test(token))
        throw Error("Open a valid email link, or request a new one");
      if (mode === "login") {
        const r = await api.post("/auth/login", {
          email: v.email,
          password: v.password,
        });
        setAccessToken(r.data.accessToken);
        // Stock or network failures retain unmerged guest items for review.
        try {
          await mergeGuestCart();
        } catch {
          /* The cart screen offers a retry. */
        }
        return;
      }
      if (mode === "register")
        return api.post("/auth/register", {
          email: v.email,
          name: v.name,
          password: v.password,
        });
      if (mode === "forgot" || mode === "request-verification")
        return api.post(
          "/auth/request-" +
            (mode === "forgot" ? "reset-password" : "verify-email"),
          { email: v.email },
        );
      return api.post(
        "/auth/" + (mode === "verify" ? "verify-email" : "reset-password"),
        { token, ...(mode === "reset" ? { password: v.password } : {}) },
      );
    },
    onSuccess: () => {
      if (mode === "login") {
        qc.clear();
        const next = params.get("next") || "";
        // Only supported local admin routes may be used as a return destination.
        const adminDestination =
          /^\/admin(?:\/(?:users|sellers|products|categories|orders)(?:\/[a-f\d]{24})?)?(?:\?[^#]*)?$/.test(
            next,
          )
            ? next
            : "/admin";
        nav(
          administrator
            ? adminDestination
            : seller
              ? "/seller"
              : next === "/checkout"
                ? "/checkout"
                : hadGuestCart
                  ? "/cart"
                  : "/account",
          { replace: true },
        );
      }
      if (mode === "verify" || mode === "reset")
        nav(mode === "verify" ? "/verify-email" : "/reset-password", {
          replace: true,
        });
    },
    onError: (e) => {
      if (!axios.isAxiosError(e)) setValidation(e.message);
    },
  });
  const titles = {
    login: "Welcome back.",
    register: "Find your place.",
    forgot: "Reset your password.",
    "request-verification": "Verify your email.",
    verify: "Confirm your email.",
    reset: "Choose a new password.",
  };
  return (
    <div className="auth-page-shell">
      <section className="section narrow auth-page">
        <p className="eyebrow">
          {administrator
            ? "MarketHub administration"
            : seller
              ? "MarketHub seller center"
              : "Your MarketHub account"}
        </p>
        <h1>
          {administrator
            ? "Administrator sign in."
            : seller
              ? "Seller sign in."
              : titles[mode]}
        </h1>
        {mode === "login" && checkoutQuery && !seller && !administrator && (
          <p className="muted">
            Your guest cart is saved. Sign in to continue to checkout.
          </p>
        )}
        {seller && (
          <p className="muted">
            Sign in with your seller account to add products, manage inventory,
            and fulfill orders. Your store must be approved before you can
            publish products.
          </p>
        )}
        {administrator && (
          <p className="muted">
            Sign in with your existing administrator email and password to
            manage MarketHub. Customer and seller accounts do not have
            administrator access.
          </p>
        )}
        {submit.isSuccess && mode !== "login" ? (
          <div className="application-status" role="status">
            <p>
              {mode === "register"
                ? "Account created. Request a verification email to finish setup."
                : mode === "verify"
                  ? "Email verified. You can sign in."
                  : mode === "reset"
                    ? "Password updated. All sessions have been revoked."
                    : "If your account is eligible, an email has been sent. Check your inbox."}
            </p>
            <Link
              to={
                (mode === "register" ? "/request-verification" : "/sign-in") +
                checkoutQuery
              }
            >
              {mode === "register"
                ? "Request verification email →"
                : "Back to sign in →"}
            </Link>
          </div>
        ) : (
          <form
            className="checkout-form"
            onSubmit={handleSubmit((v) => submit.mutate(v))}
          >
            {mode === "register" && (
              <label>
                Full name
                <input
                  autoComplete="name"
                  maxLength={80}
                  {...register("name")}
                />
              </label>
            )}
            {["login", "register", "forgot", "request-verification"].includes(
              mode,
            ) && (
              <label>
                Email address
                <input
                  type="email"
                  required
                  autoComplete="username"
                  maxLength={254}
                  {...register("email")}
                />
              </label>
            )}
            {["login", "register", "reset"].includes(mode) && (
              <label>
                Password
                <input
                  type="password"
                  required
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  {...register("password")}
                />
                <small>12–72 characters, at most 72 UTF-8 bytes.</small>
              </label>
            )}
            {["register", "reset"].includes(mode) && (
              <label>
                Confirm password
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  {...register("confirm")}
                />
              </label>
            )}
            {validation && (
              <p className="commerce-error" role="alert">
                {validation}
              </p>
            )}
            <ErrorMessage
              error={axios.isAxiosError(submit.error) ? submit.error : null}
            />
            <button className="primary" disabled={submit.isPending}>
              {submit.isPending
                ? "Please wait…"
                : mode === "login"
                  ? "Sign in"
                  : mode === "register"
                    ? "Create account"
                    : mode === "verify"
                      ? "Verify email"
                      : mode === "reset"
                        ? "Save new password"
                        : "Send email"}
            </button>
          </form>
        )}
        <div className="account-links">
          {administrator || seller ? (
            <Link to="/">Return to marketplace</Link>
          ) : (
            <>
              <Link to={"/sign-in" + checkoutQuery}>Sign in</Link>
              <Link to={"/register" + checkoutQuery}>Create account</Link>
            </>
          )}
          {seller && (
            <Link to="/seller/application">Apply to become a seller</Link>
          )}
          <Link to={"/forgot-password" + checkoutQuery}>Forgot password</Link>
          <Link to={"/request-verification" + checkoutQuery}>
            Resend verification
          </Link>
        </div>
      </section>
    </div>
  );
}
type Profile = {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  verified: boolean;
  avatar?: string;
};
export function AccountPage() {
  const nav = useNavigate(),
    qc = useQueryClient();
  const [name, setName] = useState<string | undefined>(),
    [current, setCurrent] = useState(""),
    [next, setNext] = useState(""),
    [confirmation, setConfirmation] = useState(false),
    [deactivatePassword, setDeactivatePassword] = useState(""),
    [notice, setNotice] = useState("");
  const q = useQuery({
    queryKey: ["session-user"],
    queryFn: async () =>
      (await api.get<{ user: Profile }>("/users/me")).data.user,
    retry: false,
  });
  const action = useMutation({
    mutationFn: async (type: string) => {
      setNotice("");
      if (type === "name") {
        if ((name ?? "").trim().length < 2)
          throw Error("Enter a name of at least two characters");
        return api.patch("/users/me", { name });
      }
      if (type === "logout") return api.post("/auth/logout");
      if (type === "password") {
        if (!password.safeParse(next).success)
          throw Error(
            "New password must be 12–72 characters and at most 72 UTF-8 bytes",
          );
        return api.post("/users/me/password", {
          currentPassword: current,
          newPassword: next,
        });
      }
      return api.delete("/users/me", {
        data: { password: deactivatePassword },
      });
    },
    onSuccess: (_r, type) => {
      if (type === "name") {
        setNotice("Profile updated.");
        void qc.invalidateQueries({ queryKey: ["session-user"] });
      } else {
        setAccessToken("");
        qc.clear();
        nav("/sign-in");
      }
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append("image", file);
      return api.post("/users/me/avatar", form, { timeout: 60000 });
    },
    onSuccess: () => {
      setNotice("Profile image updated.");
      void qc.invalidateQueries({ queryKey: ["session-user"] });
    },
  });
  if (q.isPending)
    return (
      <div className="state" aria-busy>
        Loading your account…
      </div>
    );
  if (q.isError)
    return (
      <section className="section state">
        <h1>Sign in to manage your account.</h1>
        <ErrorMessage error={q.error} />
        <Link className="primary" to="/sign-in">
          Sign in
        </Link>{" "}
        <button className="secondary" onClick={() => void q.refetch()}>
          Retry
        </button>
      </section>
    );
  const u = q.data;
  return (
    <section className="section">
      <p className="eyebrow">Your account, your details</p>
      <div className="section-heading">
        <h1>Hello, {u.name}.</h1>
        <button
          className="secondary"
          disabled={action.isPending}
          onClick={() => action.mutate("logout")}
        >
          Sign out
        </button>
      </div>
      <p className="muted">
        {u.email} · {u.role} ·{" "}
        {u.verified ? "Email verified" : "Email not verified"}
      </p>
      <div className="shopping-layout">
        <div className="checkout-form">
          <h2>Personal information</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              action.mutate("name");
            }}
          >
            <label>
              Full name
              <input
                value={name ?? u.name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={action.isPending || (name ?? "").trim().length < 2}
            >
              Save name
            </button>
          </form>
          <section className="review-section">
            <h2>Change password</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                action.mutate("password");
              }}
            >
              <label>
                Current password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                />
              </label>
              <label>
                New password
                <input
                  type="password"
                  required
                  autoComplete="new-password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                />
              </label>
              <p className="muted">
                Changing your password signs out all sessions.
              </p>
              <button className="primary" disabled={action.isPending}>
                Change password
              </button>
            </form>
          </section>
          <ErrorMessage error={action.error} />
          {action.error && !axios.isAxiosError(action.error) && (
            <p className="commerce-error">{action.error.message}</p>
          )}
          {notice && <p role="status">{notice}</p>}
        </div>
        <aside className="summary-box">
          <h2>Profile image</h2>
          {u.avatar && (
            <img className="profile-avatar" src={u.avatar} alt={u.name} />
          )}
          <label>
            PNG/JPEG/WebP, up to 4 MB
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
          <ErrorMessage error={upload.error} />
          {upload.isPending && <p role="status">Uploading…</p>}
          <div className="account-links">
            <Link to="/orders">Your orders</Link>
            <Link to="/wishlist">Wishlist</Link>
            <Link to="/seller/application">Sell with us</Link>
            <Link to="/notifications">Notifications</Link>
          </div>
          {u.role !== "admin" && (
            <>
              <h3>Account status</h3>
              <p className="muted">
                Deactivation signs you out and hides your store listings.
                Contact an administrator to reactivate.
              </p>
              {confirmation ? (
                <form
                  className="checkout-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    action.mutate("deactivate");
                  }}
                >
                  <label>
                    Confirm your password
                    <input
                      type="password"
                      required
                      autoComplete="current-password"
                      value={deactivatePassword}
                      onChange={(e) => setDeactivatePassword(e.target.value)}
                    />
                  </label>
                  <button className="primary" disabled={action.isPending}>
                    Confirm deactivation
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setConfirmation(false)}
                  >
                    Keep account
                  </button>
                </form>
              ) : (
                <button
                  className="secondary"
                  onClick={() => setConfirmation(true)}
                >
                  Deactivate account
                </button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
